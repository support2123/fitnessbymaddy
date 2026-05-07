import { supabase } from './lib/supabase.js';
import { sendTemplate } from './lib/whatsapp.js';
import { logMessage } from './lib/rate-limit.js';
import { escalateToMaddy } from './lib/escalation.js';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anavar', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function checkSafety(content) {
  const lower = content.toLowerCase();
  return SAFETY_FLAGS.some((flag) => lower.includes(flag));
}

async function callClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const prompt = `You are a program architect for FitnessByMaddy, an elite online coaching brand.

Generate a personalized Week ${week_no} program for this client.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries/Limitations: ${intake.injuries || 'None'}
- Diet Preference: ${intake.diet_preference || 'No restriction'}
- Experience: ${intake.experience_level || 'Intermediate'}
- Schedule: ${intake.schedule || '5 days/week'}` : ''}

RECENT CHECK-INS:
${checkins?.map((c) => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n') || 'No previous check-ins'}

OUTPUT FORMAT (respond with valid JSON only):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": ""}] },
      ...
    ],
    "cardio": "...",
    "deload_notes": ""
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fats_g": 0,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": "...",
    "special_notes": ""
  },
  "weekly_focus": "...",
  "motivation_note": "..."
}

RULES:
- Progressive overload from previous weeks
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or supplements without evidence
- Adjust based on compliance and energy scores
- If client reports pain/injury, reduce volume on affected area`;

    const response = await callClaude(prompt);

    if (checkSafety(response)) {
      await escalateToMaddy(client.phone, 'Program safety flag', `Week ${week_no} generation flagged`);
      return res.status(200).json({ status: 'flagged_for_review', week_no });
    }

    let programData;
    try {
      programData = JSON.parse(response);
    } catch {
      programData = { raw: response };
    }

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: null,
        whatsapp_sent_at: null,
        workout_plan: programData.workout_plan || programData,
        nutrition_plan: programData.nutrition_plan || null,
        notes: programData.weekly_focus || null,
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      programData.weekly_focus || 'New week, new gains!',
    ]);
    await logMessage(client.phone, 'out', `Week ${week_no} program sent`, 'weekly_program');

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.status(200).json({ status: 'generated', program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
