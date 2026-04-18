const Anthropic = require('@anthropic-ai/sdk');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { generateProgramPDF } = require('../lib/pdf');
const { cors, parseBody, maskPhone } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 cal', 'starvation',
  'clenbuterol', 'dnp', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'crash diet',
];

function checkSafety(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.filter((flag) => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { client_id, week_no } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const db = getClient();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  // Get last 2 check-ins for context
  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  // Get previous program if exists
  const { data: prevProgram } = await db
    .from('programs')
    .select('workout_plan, nutrition_plan, notes')
    .eq('client_id', client_id)
    .eq('week_no', week_no - 1)
    .single();

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are "Program Architect" for FitnessByMaddy, an elite fitness coaching brand.
You create weekly workout and nutrition plans that are:
- Safe, science-backed, and progressive
- Tailored to the client's data and check-in feedback
- Realistic and sustainable (no crash diets, no banned substances)
- Periodized appropriately for a 12-week program

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ],
        "notes": "Focus on controlled eccentrics"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 65 },
    "meals": [
      {
        "name": "Meal 1 — Breakfast",
        "items": ["4 egg whites + 1 whole egg scramble", "1 cup oats with banana"]
      }
    ]
  },
  "notes": "Coach notes for the week..."
}

NEVER recommend: extreme calorie cuts (<1200 for women, <1500 for men), banned substances, unrealistic timelines.`;

  const userPrompt = `Client: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${week_no}/12
Started: ${client.program_started_at}

${recentCheckins && recentCheckins.length > 0
    ? `Recent check-ins:
${recentCheckins.map((c) => `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}`
    : 'No check-in data yet (first week).'}

${prevProgram
    ? `Previous week plan summary: ${prevProgram.notes || 'Standard progressive program'}`
    : 'No previous plan — design Week 1 foundation.'}

Generate the Week ${week_no} program. Ensure progressive overload from previous weeks. Adjust based on compliance and energy scores.`;

  let aiResponse;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    aiResponse = msg.content[0].text;
  } catch (err) {
    console.error('[CLAUDE-API]', err.message);
    return res.status(502).json({ error: 'Failed to generate program' });
  }

  // Safety check
  const flags = checkSafety(aiResponse);
  if (flags.length > 0) {
    console.error(`[SAFETY] Flagged content for ${maskPhone(client.phone)}: ${flags.join(', ')}`);
    await sendTemplate(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', [
      maskPhone(client.phone),
      `Program generation flagged for safety: ${flags.join(', ')}. Week ${week_no} halted.`,
    ]);
    return res.status(400).json({ error: 'Safety review required', flags });
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    console.error('[PARSE] Failed to parse Claude response');
    return res.status(500).json({ error: 'Failed to parse program output' });
  }

  const { workout_plan, nutrition_plan, notes } = parsed;

  // Generate PDF
  let pdfBuffer;
  try {
    pdfBuffer = await generateProgramPDF(
      client.name || 'Client',
      week_no,
      workout_plan,
      nutrition_plan,
      notes
    );
  } catch (err) {
    console.error('[PDF]', err.message);
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }

  // Upload PDF to Supabase Storage
  const pdfPath = `${client.id}/week_${week_no}.pdf`;
  const { error: uploadErr } = await db.storage
    .from('clients')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadErr) {
    console.error('[UPLOAD]', uploadErr.message);
  }

  const { data: urlData } = db.storage.from('clients').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  // Save to programs table (audit trail)
  const { data: program, error: dbErr } = await db
    .from('programs')
    .insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes,
    })
    .select()
    .single();

  if (dbErr) {
    console.error('[PROGRAM-SAVE]', dbErr.message);
    return res.status(500).json({ error: 'Failed to save program' });
  }

  // Send via WhatsApp
  await sendTemplate(client.phone, 'program_ready', [
    client.name || 'there',
    String(week_no),
    pdfUrl,
  ]);

  // Update whatsapp_sent_at
  await db
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('id', program.id);

  console.log(`[PROGRAM] Generated week ${week_no} for ${maskPhone(client.phone)}`);

  return res.status(200).json({
    success: true,
    program_id: program.id,
    pdf_url: pdfUrl,
  });
};
