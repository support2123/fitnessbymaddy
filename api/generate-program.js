const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programLabel, cors } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'sarm', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'crash diet'
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('lead_intake')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const anthropic = new Anthropic();

    const systemPrompt = `You are Maddy's AI program architect for Fitness by Maddy. Generate a weekly training and nutrition plan for a client.

Rules:
- Evidence-based training principles only
- Never prescribe extreme calorie deficits (minimum 1200kcal for women, 1500kcal for men)
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines
- Progressive overload focus
- Consider injuries and medical conditions
- Output valid JSON with workout_plan and nutrition_plan keys

Format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "...",
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "coach_notes": "..."
}`;

    const checkinSummary = recentCheckins?.length
      ? recentCheckins.map(c =>
          `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
        ).join('\n')
      : 'No prior check-ins.';

    const clientProfile = [
      `Name: ${client.name}`,
      `Program: ${programLabel(client.program)}`,
      `Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}`,
      intake ? `Age: ${intake.age}, Gender: ${intake.gender}` : '',
      intake ? `Height: ${intake.height}cm, Starting weight: ${intake.weight}kg` : '',
      intake ? `Goal: ${intake.goal}` : '',
      intake ? `Injuries: ${intake.injuries || 'None'}` : '',
      intake ? `Diet preference: ${intake.diet_pref || 'No restriction'}` : '',
      intake ? `Schedule: ${intake.schedule || 'Flexible'}` : '',
      intake ? `Medical: ${intake.medical_conditions || 'None'}` : '',
      `\nRecent check-ins:\n${checkinSummary}`
    ].filter(Boolean).join('\n');

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate the Week ${week_no} program for this client:\n\n${clientProfile}`
      }]
    });

    const responseText = msg.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullOutput = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullOutput.includes(flag));
    if (flagged) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Safety flag in generated program',
        `Client ${client.name} (${client.id}), week ${week_no}: program flagged for manual review`
      );
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const { error: insertErr } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || null,
      pdf_url: null
    });

    if (insertErr) throw insertErr;

    const summary = programData.coach_notes
      ? programData.coach_notes.slice(0, 150)
      : `Week ${week_no} program ready!`;

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', `${week_no}`, summary]
    });

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no));

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
