const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramLabel, cors } = require('../lib/utils');

const SAFETY_KEYWORDS = [
  'extreme calorie', 'under 1000 cal', 'steroids', 'sarms', 'clenbuterol',
  'dnp', 'ephedra', 'crash diet', 'water fast',
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
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

  const prompt = buildPrompt(client, recentCheckins || [], week_no);

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    return res.status(500).json({ error: 'Claude API failed', details: err });
  }

  const claudeData = await claudeRes.json();
  const rawContent = claudeData.content[0].text;

  if (SAFETY_KEYWORDS.some(k => rawContent.toLowerCase().includes(k))) {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [client.name || 'Client', `Week ${week_no} program flagged for safety review`, 'Contains potentially risky recommendations']
    );
    return res.status(200).json({ success: false, reason: 'safety_flagged' });
  }

  let parsed;
  try {
    const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawContent);
  } catch {
    parsed = { raw: rawContent };
  }

  const workoutPlan = parsed.workout_plan || parsed.workouts || {};
  const nutritionPlan = parsed.nutrition_plan || parsed.nutrition || {};
  const notes = parsed.notes || parsed.coach_notes || '';

  const pdfUrl = `clients/${client_id}/week_${week_no}.json`;

  await db.storage.from('clients').upload(
    `${client_id}/week_${week_no}.json`,
    JSON.stringify(parsed, null, 2),
    { contentType: 'application/json', upsert: true }
  );

  await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    pdf_url: pdfUrl,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
    notes,
  });

  const label = getProgramLabel(client.program);
  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    notes || `Your ${label} program for this week is ready. Let's crush it!`,
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

  return res.status(200).json({ success: true, week_no });
};

function buildPrompt(client, checkins, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  let context = `You are a program architect for FitnessByMaddy, an elite online coaching brand.
Generate a detailed weekly training and nutrition program for Week ${weekNo}.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${getProgramLabel(client.program)}
- Started: ${client.program_started_at}
`;

  if (lastCheckin) {
    context += `
LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy: ${lastCheckin.energy || 'N/A'}/10
- Issues: ${lastCheckin.issues || 'None'}
`;
  }

  if (prevCheckin) {
    context += `
PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${prevCheckin.waist || 'N/A'} cm
- Compliance: ${prevCheckin.compliance_score || 'N/A'}/10
- Energy: ${prevCheckin.energy || 'N/A'}/10
`;
  }

  context += `
OUTPUT FORMAT — respond with a single JSON block in \`\`\`json\`\`\`:
{
  "workout_plan": {
    "day_1": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..."}] },
    "day_2": { ... },
    ...
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_1": { "time": "8am", "description": "..." },
    "meal_2": { ... },
    ...
  },
  "notes": "Short coach note for WhatsApp delivery (1-2 sentences max)"
}

RULES:
- Never recommend extreme calorie restriction (below 1200 for women, 1500 for men)
- Never recommend banned substances or supplements without evidence
- Be progressive — adjust based on compliance and energy from check-ins
- Keep workouts to 45-60 min, 4-5 days/week
- Include rest days
- Tone: warm, expert, encouraging. No bro-science.
`;

  return context;
}
