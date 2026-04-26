const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { logMessage } = require('./_lib/rate-limit');
const { json, maskPhone } = require('./_lib/helpers');

const MADDY_PHONE = '917082478374';

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroid', 'sarm', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return json(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, 404, { error: 'Client not found' });

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

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and sports nutritionist creating a weekly program for a real client. You must output valid JSON only — no markdown, no explanation outside the JSON.

RULES:
- Programs must be safe and evidence-based
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances or supplements
- Progression must be gradual (max 10% volume increase per week)
- Include rest days
- Account for any injuries or medical conditions mentioned

Output format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "notes": "..."}], "duration_min": 45 }
    ],
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "notes": "..."
  },
  "coach_note": "One-liner context for WhatsApp message"
}`;

    const checkinSummary = recentCheckins && recentCheckins.length > 0
      ? recentCheckins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`).join('\n')
      : 'No previous check-ins available.';

    const intakeSummary = intake
      ? `Age: ${intake.age}, Goal: ${intake.goal}, Injuries: ${intake.injuries || 'none'}, Diet: ${intake.diet_preference || 'flexible'}, Schedule: ${intake.schedule || 'standard'}, Medical: ${intake.medical_conditions || 'none'}`
      : 'No intake data available.';

    const userPrompt = `Create Week ${week_no} program for this client:

Name: ${client.name || 'Client'}
Program: ${client.program}
${intakeSummary}

Recent check-ins:
${checkinSummary}

Generate a progressive, personalised program for week ${week_no}. Output JSON only.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    if (hasSafetyIssue(rawOutput)) {
      await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
        maskPhone(client.phone),
        `SAFETY FLAG: Week ${week_no} program for ${client.name || 'client'} contains risky content. Review before sending.`,
      ]);
      return json(res, 200, { action: 'flagged_for_review', week_no });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_note || null,
    });

    if (progErr) {
      console.error('program insert error:', progErr.message);
    }

    const coachNote = parsed.coach_note || `Your Week ${week_no} program is ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      coachNote,
    ]);
    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'weekly_program');

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return json(res, 200, { action: 'generated', week_no, client_id });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return json(res, 500, { error: 'Program generation failed' });
  }
};
