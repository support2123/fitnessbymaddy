const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 calories', 'starvation',
  'banned substance', 'steroid', 'dnp', 'clenbuterol',
  'lose 10kg in 1 week', 'crash diet', 'very low calorie'
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const intake = client.leads?.intake_data || {};

    const systemPrompt = `You are a certified personal trainer and nutrition coach for Fitness by Maddy.
You create personalised weekly workout and nutrition plans.

RULES:
- Never prescribe fewer than 1200 calories/day for women or 1500 for men
- Never recommend banned substances, steroids, or extreme measures
- Always include rest days
- Prioritise progressive overload and sustainability
- Consider injuries, medical conditions, and dietary preferences
- For PCOS clients: focus on insulin sensitivity, anti-inflammatory foods
- For 40+ clients: prioritise joint-friendly movements, adequate protein

Output ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 3, "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "macros": { "calories": 2000, "protein": 150, "carbs": 200, "fat": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg", "1 cup oats"] }
    ]
  },
  "notes": "Brief coach note about focus for this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for:
Name: ${client.name || 'Client'}
Program: ${client.program}
Goal: ${intake.goal || 'general fitness'}
Age: ${intake.age || 'unknown'}
Gender: ${intake.gender || 'unknown'}
Current Weight: ${intake.current_weight || 'unknown'}
Target Weight: ${intake.target_weight || 'unknown'}
Experience: ${intake.experience_level || 'intermediate'}
Injuries: ${intake.injuries || 'none reported'}
Diet Preference: ${intake.diet_pref || 'no restrictions'}
Medical: ${intake.medical_conditions || 'none reported'}
Schedule: ${intake.workout_schedule || '5 days/week'}

${recentCheckins && recentCheckins.length > 0 ? `
Recent check-ins:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}
` : 'No prior check-in data.'}`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;

    if (hasSafetyIssue(rawOutput)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Program safety flag', {
        phone: client.phone,
        detail: `Week ${week_no} program for ${client.name} flagged for safety review`
      });
      return res.status(200).json({
        success: false,
        reason: 'safety_flagged',
        message: 'Program flagged for manual review'
      });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('Failed to parse Claude output');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      parsed.workout,
      parsed.nutrition,
      parsed.notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout,
      nutrition_plan: parsed.nutrition,
      notes: parsed.notes || null
    });

    const market = detectMarket(client.phone);
    const contextNote = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! Check karo aur koi doubt ho toh poocho.`
      : `Your Week ${week_no} program is ready! Check it out and let me know if you have questions.`;

    await sendTemplate(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(week_no),
        contextNote
      ],
      media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` }
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
