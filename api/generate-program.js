const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'sarms', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const { data: lastProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the program architect for FitnessByMaddy, an elite online fitness coaching brand.
You create personalized weekly workout and nutrition plans.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or extreme protocols
- Never promise specific weight loss timelines (e.g., "lose 10kg in 2 weeks")
- Always include rest days (minimum 1-2 per week)
- Consider injuries and limitations noted in the client profile
- Plans should be progressive — building on the previous week
- Use RPE (Rate of Perceived Exertion) for intensity guidance
- Include warm-up and cool-down recommendations

Output STRICTLY as JSON with this structure:
{
  "workout_plan": {
    "summary": "Brief week overview",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fats_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "One-liner context for the WhatsApp message"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Age: ${client.age || 'Unknown'}
- Goal: ${client.goal || 'General fitness'}
- Injuries/Limitations: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restrictions'}
- Schedule: ${client.schedule || 'Flexible'}

${recentCheckins && recentCheckins.length > 0 ? `
RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}
` : 'No previous check-in data available.'}

${lastProgram ? `
LAST WEEK'S PROGRAM SUMMARY:
${lastProgram.workout_plan?.summary || 'N/A'}
Calories: ${lastProgram.nutrition_plan?.calories || 'N/A'}
` : 'This is the first week — build a foundation program.'}

Generate a progressive, safe, and effective Week ${week_no} plan.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    let flagged = false;
    let flagReason = null;
    for (const flag of SAFETY_FLAGS) {
      if (fullText.includes(flag)) {
        flagged = true;
        flagReason = `Safety flag: "${flag}" found in generated program`;
        break;
      }
    }

    if (programData.nutrition_plan?.calories) {
      const cals = programData.nutrition_plan.calories;
      if (cals < 1200) {
        flagged = true;
        flagReason = `Calories too low: ${cals}`;
      }
    }

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note || null,
        flagged,
        flag_reason: flagReason,
      })
      .select('id')
      .single();

    if (flagged) {
      const { notifyMaddy } = require('./lib/escalation');
      await notifyMaddy('Program flagged for review', {
        phone: client.phone,
        detail: flagReason,
      });
      return res.status(200).json({
        ok: true,
        program_id: program.id,
        flagged: true,
        flag_reason: flagReason,
        note: 'Program saved but NOT sent — needs Maddy review',
      });
    }

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      programData.coach_note || `Your Week ${week_no} plan is ready!`,
    ]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
