const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPdf } = require('../lib/pdf');
const { sendRateLimited } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const { createEscalation } = require('../lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme cut', 'crash diet',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return flag;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    let intakeData = {};
    const { data: lead } = await db
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .maybeSingle();

    if (lead?.first_msg) {
      try { intakeData = JSON.parse(lead.first_msg); } catch {}
    }

    const prompt = buildPrompt(client, intakeData, recentCheckins, parseInt(week_no));

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content[0].text;

    const safetyFlag = checkSafety(responseText);
    if (safetyFlag) {
      await createEscalation(
        client.phone,
        `Program safety flag: "${safetyFlag}" in generated content for week ${week_no}`,
        responseText.substring(0, 500),
        client_id
      );
      return res.status(422).json({ error: 'Safety flag triggered', flag: safetyFlag });
    }

    let parsed;
    try {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : responseText);
    } catch {
      parsed = { workout_plan: { days: [] }, nutrition_plan: { meals: [] }, notes: responseText };
    }

    const workoutPlan = parsed.workout_plan || parsed.workoutPlan || { days: [] };
    const nutritionPlan = parsed.nutrition_plan || parsed.nutritionPlan || { meals: [] };
    const notes = parsed.notes || parsed.coach_notes || '';

    const pdfBuffer = await generateProgramPdf(
      client.name || 'Client',
      parseInt(week_no),
      workoutPlan,
      nutritionPlan,
      notes
    );

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: publicUrl } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const { data: program, error: insertError } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl?.publicUrl || pdfPath,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
    }).select().single();

    if (insertError) throw insertError;

    const market = detectMarket(client.phone);
    let contextNote;
    if (isHinglish(market)) {
      contextNote = `Week ${week_no} ka program ready hai! PDF check karo aur koi doubt ho toh message karo.`;
    } else {
      contextNote = `Your Week ${week_no} program is ready! Check the PDF and message us if you have any questions.`;
    }

    const sendResult = await sendRateLimited(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no)],
      contextNote
    );

    if (sendResult.success) {
      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: publicUrl?.publicUrl || pdfPath,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  const checkinSummary = (checkins || []).map(c =>
    `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10, Issues: ${c.issues || 'None'}`
  ).join('\n');

  return `You are a certified fitness program architect for Fitness by Maddy. Generate a detailed, safe, science-backed weekly program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}
${intake.age ? `- Age: ${intake.age}` : ''}
${intake.gender ? `- Gender: ${intake.gender}` : ''}
${intake.goal ? `- Goal: ${intake.goal}` : ''}
${intake.injuries ? `- Injuries/Limitations: ${intake.injuries}` : ''}
${intake.diet_preference ? `- Diet Preference: ${intake.diet_preference}` : ''}
${intake.experience_level ? `- Experience Level: ${intake.experience_level}` : ''}
${intake.current_weight ? `- Current Weight: ${intake.current_weight}kg` : ''}
${intake.target_weight ? `- Target Weight: ${intake.target_weight}kg` : ''}

RECENT CHECK-INS:
${checkinSummary || 'No previous check-ins'}

RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Include warm-up and cool-down in every workout
- Progressive overload: adjust based on previous week's compliance and energy
- If compliance is low, simplify the program
- If energy is low, reduce volume by 10-20%
- Include rest days (minimum 1-2 per week)

Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "dailyCalories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 65,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "time": "8:00 AM",
        "items": ["4 egg whites + 1 whole egg scrambled", "1 cup oats with berries"],
        "calories": 450
      }
    ]
  },
  "notes": "Coach notes for this week..."
}
\`\`\``;
}
