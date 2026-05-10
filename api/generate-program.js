const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'anabolic steroid', 'testosterone inject'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*, leads:lead_id(market)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await db
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

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
      .eq('week_no', week_no)
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are the Program Architect for FitnessByMaddy, an elite online coaching brand.
You create personalised weekly workout and nutrition plans.

RULES:
- Be evidence-based. No bro-science.
- Never prescribe below 1200 kcal/day for women or 1500 kcal/day for men.
- Never recommend banned substances, SARMs, or anabolic steroids.
- Never promise specific weight loss timelines.
- Consider injuries, medical conditions, and client preferences.
- Progressive overload: slightly increase intensity each week.
- Output valid JSON only — no markdown, no explanation outside the JSON.

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": { "type": "LISS or HIIT", "frequency": "3x/week", "duration": "20-30min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fats_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Oats with protein powder and banana", "Egg whites with toast"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g daily"],
    "hydration": "3-4L water daily"
  },
  "notes": "Focus on progressive overload this week. Increase bench press by 2.5kg."
}`;

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: intake ? {
        age: intake.age,
        gender: intake.gender,
        height: intake.height_cm,
        weight: intake.weight_kg,
        goal: intake.goal,
        injuries: intake.injuries,
        diet: intake.diet_preference,
        schedule: intake.training_schedule,
        medical: intake.medical_conditions
      } : null,
      recent_checkins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const userPrompt = `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientProfile, null, 2)}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;

    const lower = rawOutput.toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => lower.includes(flag));
    if (flagged) {
      await escalateToMaddy(
        'Safety flag in generated program',
        client.phone,
        `Week ${week_no} program flagged for review. Client: ${maskPhone(client.phone)}`
      );
      return res.status(200).json({ flagged: true, message: 'Program flagged for manual review' });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('Failed to parse Claude output:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { error: progErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.notes || null
    });

    if (progErr) {
      console.error('Program insert error:', progErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      `Week ${week_no}`,
      parsed.notes || 'Your new program is ready!'
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
