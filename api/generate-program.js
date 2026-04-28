const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { generateProgramPDF } = require('./_lib/pdf');
const { cors, parseBody } = require('./_lib/helpers');

const RISKY_KEYWORDS = [
  'extreme calorie', 'under 1000 cal', 'under 800 cal',
  'starvation', 'diuretic', 'clenbuterol', 'dnp', 'steroid',
  'anabolic', 'sarm', 'ephedrine', 'crash diet'
];

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { client_id, week_no } = body;
  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: leadData } = client.lead_id
    ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
    : { data: null };

  const intake = leadData?.intake_data || {};

  const systemPrompt = `You are a NASM-certified fitness coach creating a weekly program.
Output ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s" }
        ]
      }
    ]
  },
  "nutrition": {
    "daily_calories": 2000,
    "protein_g": 150,
    "meals": [
      { "name": "Breakfast", "description": "...", "macros": "P30 C40 F15" }
    ]
  },
  "notes": "Coach notes for the week"
}

Rules:
- Never recommend below 1200 calories for women or 1500 for men
- Never suggest any banned substances or supplements requiring prescription
- Base progression on previous check-in data
- Be specific with exercise names, sets, reps, and rest periods
- Include warm-up and cool-down guidance in notes`;

  const userPrompt = `Client: ${client.name}
Program: ${client.program}
Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}
${intake.age ? `Age: ${intake.age}` : ''}
${intake.goal ? `Goal: ${intake.goal}` : ''}
${intake.injuries ? `Injuries/limitations: ${intake.injuries}` : ''}
${intake.diet_pref ? `Diet preference: ${intake.diet_pref}` : ''}
${intake.schedule ? `Schedule: ${intake.schedule}` : ''}

${checkins && checkins.length > 0 ? `Recent check-ins:
${checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? ', Issues: ' + c.issues : ''}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

Generate the Week ${week_no} program.`;

  let aiResponse;
  try {
    const anthropic = new Anthropic();
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    aiResponse = msg.content[0].text;
  } catch (err) {
    return res.status(500).json({ error: 'AI generation failed' });
  }

  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);
  } catch {
    return res.status(500).json({ error: 'Failed to parse AI response' });
  }

  const fullText = JSON.stringify(parsed).toLowerCase();
  const flagged = RISKY_KEYWORDS.some(kw => fullText.includes(kw));

  if (flagged) {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [maskPhone(client.phone), `Week ${week_no} program flagged for risky content — needs review`]
    );
    return res.status(200).json({ ok: true, flagged: true, message: 'Flagged for review' });
  }

  let pdfBuffer;
  try {
    pdfBuffer = await generateProgramPDF(
      client.name,
      week_no,
      parsed.workout,
      parsed.nutrition,
      parsed.notes
    );
  } catch {
    return res.status(500).json({ error: 'PDF generation failed' });
  }

  const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await db.storage
    .from('programs')
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (uploadError) {
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage
    .from('programs')
    .getPublicUrl(pdfPath);

  const pdfUrl = urlData?.publicUrl || '';

  await db.from('programs').insert({
    client_id,
    week_no: parseInt(week_no),
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: parsed.workout,
    nutrition_plan: parsed.nutrition,
    notes: parsed.notes
  });

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no)
  ], pdfUrl);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no));

  return res.status(200).json({ ok: true, pdf_url: pdfUrl });
};
