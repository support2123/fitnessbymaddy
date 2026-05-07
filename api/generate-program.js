const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { logMessage } = require('./_lib/rate-limit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'ephedra', 'sarm', 'steroid', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme deficit', 'water fasting for'
];

function hasSafetyIssue(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('lead_intakes')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert NASM-certified personal trainer and nutrition coach. Generate a weekly training and nutrition plan for a client.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never prescribe fewer than 1200 calories for women or 1500 for men
- Never recommend banned substances, SARMs, steroids, or extreme protocols
- Include warm-up and cool-down in every session
- Adjust intensity based on compliance score and reported issues
- Use RPE (Rate of Perceived Exertion) for intensity guidance

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]}
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "context_note": "One line summary for WhatsApp message"
}`;

    const userPrompt = `Generate Week ${week_no} program for:
Client: ${client.name || 'Client'}
Program: ${client.program}
${intake ? `Age: ${intake.age}, Gender: ${intake.gender}, Goal: ${intake.goal}
Experience: ${intake.experience}, Weight: ${intake.current_weight}kg, Height: ${intake.height}cm
Injuries: ${intake.injuries || 'None reported'}
Diet preference: ${intake.diet_pref || 'No preference'}
Schedule: ${intake.schedule || 'Flexible'}` : 'No intake data available — design a moderate general program.'}

${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}` : 'No previous check-in data.'}

${week_no > 1 ? 'Progressively adjust from last week — increase volume or intensity if compliance is high, reduce if energy/compliance is low.' : 'This is Week 1 — start moderate, establish baseline.'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;

    if (hasSafetyIssue(rawOutput)) {
      console.error(`SAFETY FLAG: Program for ${maskPhone(client.phone)} week ${week_no} flagged`);
      await sendTemplate('917082478374', 'escalation_alert', [
        client.name || maskPhone(client.phone),
        'Program safety flag — review before sending',
        rawOutput.slice(0, 200)
      ]);

      await db.from('programs').insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: null,
        nutrition_plan: null,
        notes: 'SAFETY FLAGGED — awaiting Maddy review',
        pdf_url: null
      });

      return res.status(200).json({ success: false, reason: 'safety_flagged' });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { error: progError } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: parsed.context_note || null,
      pdf_url: null
    });

    if (progError) {
      console.error('Program insert error:', progError.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    const contextNote = parsed.context_note || `Week ${week_no} program is ready!`;
    try {
      await sendText(client.phone, `Your Week ${week_no} program is ready! ${contextNote}\n\nCheck your dashboard for the full plan.`);
      await logMessage(client.phone, 'out', contextNote, null);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', week_no);
    } catch (sendErr) {
      console.error('WA send failed:', sendErr.message);
    }

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
