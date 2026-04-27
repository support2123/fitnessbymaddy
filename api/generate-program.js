const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d+\s*kg\s*in\s*\d\s*day/i
];

function hasSafetyIssue(text) {
  return RISKY_PATTERNS.some(p => p.test(text));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['x-api-key'];
  if (authHeader !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeRaw } = await db.storage
      .from('intake-forms')
      .download(`${client.lead_id}.json`);

    let intakeData = null;
    if (intakeRaw) {
      try {
        intakeData = JSON.parse(await intakeRaw.text());
      } catch (_) {}
    }

    const prompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no} of 12
${intakeData ? `
Age: ${intakeData.age || 'N/A'}
Gender: ${intakeData.gender || 'N/A'}
Goal: ${intakeData.goal || 'General fitness'}
Injuries/Conditions: ${intakeData.injuries || 'None reported'}
Diet Preference: ${intakeData.diet_pref || 'No restrictions'}
Schedule: ${intakeData.schedule || 'Flexible'}
Current Weight: ${intakeData.current_weight || 'N/A'}
Height: ${intakeData.height || 'N/A'}
` : ''}
RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0
  ? recentCheckins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins yet (Week 1)'}

Create a complete weekly program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "Brief coach note about this week's focus"
}

RULES:
- Never prescribe fewer than 1400 calories for women or 1600 for men
- Never recommend banned substances
- Adjust based on check-in data if available
- Be specific with exercise names and progression
- Keep it practical and achievable`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = response.content[0].text;

    if (hasSafetyIssue(rawText)) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy('Risky content in generated program', {
        client_id,
        phone: maskPhone(client.phone),
        week_no,
        flagged_content: rawText.substring(0, 500)
      });
      return res.status(200).json({ flagged: true, reason: 'Safety review required' });
    }

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch (_) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const { data: program, error } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes || null
    }).select().single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const summaryMsg = `Week ${week_no} program is ready!\n\n${parsed.notes || ''}\n\nFocus: ${parsed.workout_plan?.days?.[0]?.focus || 'Progressive training'}\nCalories: ${parsed.nutrition_plan?.calories || 'See plan'}\nProtein: ${parsed.nutrition_plan?.protein_g || 'See plan'}g\n\nFull plan sent to your dashboard. Let's crush it!`;

    await sendWhatsApp(client.phone, summaryMsg, null);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
