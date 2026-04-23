const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { buildPDF, uploadPDF } = require('./_lib/pdf');
const { corsHeaders, parseBody, PROGRAM_NAMES } = require('./_lib/utils');
const { escalate } = require('./_lib/escalate');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'banned substance', 'steroid', 'clenbuterol', 'dnp',
  'lose 10kg in 1 week', 'drop 20 pounds in a week'
];

function checkSafety(text) {
  const lower = (typeof text === 'string' ? text : JSON.stringify(text)).toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const client = await db.from('clients').select('*').eq('id', client_id).single();
  if (!client.data) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await db.from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: prevProgram } = await db.from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(1)
    .single();

  const clientData = {
    name: client.data.name,
    program: client.data.program,
    program_name: PROGRAM_NAMES[client.data.program],
    week_no,
    recent_checkins: recentCheckins || [],
    previous_program: prevProgram || null
  };

  const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Be evidence-based. No bro-science.
- Never prescribe below 1200 kcal/day for women or 1500 kcal/day for men
- Never recommend banned substances, steroids, or extreme protocols
- Progressive overload is key — build on the previous week
- Warm, supportive tone — the client reads the notes section
- All exercises must include sets, reps, and rest periods
- Account for any reported injuries or issues from check-ins

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "notes": ""
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 70 },
    "meals": [
      { "name": "Meal 1 - Breakfast", "description": "..." }
    ],
    "notes": ""
  },
  "coach_notes": "Motivational and directive note for the client about this week's focus."
}`;

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  let aiResponse;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientData, null, 2)}`
      }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    aiResponse = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return res.status(500).json({ error: 'AI generation failed', detail: err.message });
  }

  if (checkSafety(aiResponse)) {
    await escalate(
      client.data.phone,
      'unsafe_program_content',
      `Week ${week_no} program flagged for safety review`,
      client_id
    );
    return res.status(200).json({ action: 'flagged_for_review', week_no });
  }

  const pdfBuffer = await buildPDF(
    client.data.name || 'Client',
    week_no,
    aiResponse.workout_plan,
    aiResponse.nutrition_plan,
    aiResponse.coach_notes
  );

  const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

  const { error: insertErr } = await db.from('programs').upsert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: aiResponse.workout_plan,
    nutrition_plan: aiResponse.nutrition_plan,
    notes: aiResponse.coach_notes
  }, { onConflict: 'client_id,week_no' });

  if (insertErr) {
    return res.status(500).json({ error: 'Failed to store program' });
  }

  const contextNote = aiResponse.coach_notes
    ? aiResponse.coach_notes.split('.')[0] + '.'
    : `Week ${week_no} program is ready!`;

  await sendWhatsApp(
    client.data.phone,
    `\u{1F4CB} Your Week ${week_no} Program is ready!\n\n${contextNote}\n\nPDF: ${pdfUrl}`,
    'weekly_program'
  );

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('client_id', client_id).eq('week_no', week_no);

  return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
};
