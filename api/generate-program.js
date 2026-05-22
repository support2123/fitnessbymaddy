const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { createProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendMediaTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'steroid', 'anabolic', 'testosterone injection',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.find(flag => lower.includes(flag)) || null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await sb
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lead } = await sb
      .from('leads')
      .select('first_msg, market')
      .eq('id', client.lead_id)
      .maybeSingle();

    let intakeData = {};
    try {
      intakeData = JSON.parse(lead?.first_msg || '{}');
    } catch { /* not JSON intake */ }

    const prompt = buildPrompt(client, intakeData, recentCheckins || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content[0].text;

    const safetyIssue = checkSafety(responseText);
    if (safetyIssue) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        client.phone,
        `unsafe_program_content: ${safetyIssue}`,
        `Week ${week_no} program for ${client.name} flagged for safety review. Content contained: "${safetyIssue}"`,
        client_id
      );
      return res.status(200).json({ action: 'flagged_for_review', reason: safetyIssue });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      parsed = { workout_plan: { days: [] }, nutrition_plan: {}, notes: responseText.slice(0, 500) };
    }

    const workout = parsed.workout_plan || parsed.workout || {};
    const nutrition = parsed.nutrition_plan || parsed.nutrition || {};
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfBuffer = await createProgramPDF(client, week_no, workout, nutrition, notes);
    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { error: insertError } = await sb.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes,
    });

    if (insertError) {
      console.error('Program save error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const market = lead?.market || 'GLOBAL';
    const contextNote = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! PDF check karo.`
      : `Your Week ${week_no} program is ready! Check the PDF.`;

    await sendMediaTemplate(client.phone, 'weekly_program', pdfUrl, {
      name: client.name || 'there',
      templateParams: [client.name || 'there', contextNote],
      filename: `week_${week_no}_program.pdf`,
    });

    await sb.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand.

Generate a Week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'N/A'}
- Program: ${client.program}
- Age: ${intake.age || 'Unknown'}
- Gender: ${intake.gender || 'Unknown'}
- Height: ${intake.height || 'Unknown'}
- Current Weight: ${lastCheckin?.weight || intake.weight || 'Unknown'}
- Goal: ${intake.goal || 'General fitness'}
- Training Experience: ${intake.training_experience || 'Unknown'}
- Equipment: ${intake.equipment_access || 'Full gym'}
- Diet Preference: ${intake.diet_preference || 'No restrictions'}
- Injuries/Conditions: ${intake.injuries || intake.medical_conditions || 'None reported'}
- Schedule: ${intake.schedule || 'Unknown'}

${lastCheckin ? `LAST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'}
- Waist: ${lastCheckin.waist || 'N/A'}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}
- Focus: ${lastCheckin.next_week_focus || 'N/A'}` : 'No previous check-in data.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

RULES:
- Design a progressive program appropriate for Week ${weekNo}
- Include 4-6 training days with rest days
- Each day: name, focus area, 5-8 exercises with sets, reps, rest periods
- Include warm-up and cool-down notes
- Nutrition: daily calorie target, macro split (protein/carbs/fat), 4-5 meals
- Be specific with food choices relevant to the client's market/preferences
- NEVER recommend extreme calorie cuts (minimum 1200 kcal for women, 1500 for men)
- NEVER recommend banned substances, SARMs, steroids, or unproven supplements
- Keep timelines realistic — max 0.5-1% body weight loss per week
- Add a coach note with motivation and weekly focus

Return ONLY valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "warmup": "5 min incline walk + arm circles",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg scramble", "2 multigrain toast", "Black coffee"] }
    ],
    "notes": "Stay hydrated — aim for 3-4L water daily"
  },
  "notes": "Great progress this week! Focus on mind-muscle connection during compounds."
}
\`\`\``;
}
