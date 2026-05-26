const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { cors, parseBody, programLabel } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = await parseBody(req);
  const { client_id, week_no } = body;

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

  const { data: existingProgram } = await db
    .from('programs')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .maybeSingle();

  if (existingProgram) {
    return res.status(200).json({ action: 'already_generated' });
  }

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client. You must output valid JSON only with two keys: "workout_plan" and "nutrition_plan".

workout_plan should have keys for each training day (e.g. "day_1", "day_2", etc.) with an array of exercises. Each exercise: { "name": string, "sets": number, "reps": string, "rest": string, "notes": string }.

nutrition_plan should have: "daily_calories": number, "protein_g": number, "carbs_g": number, "fats_g": number, "meals": array of { "meal": string, "description": string, "approx_calories": number }.

SAFETY RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- If client reports pain or injury, prescribe modified/rehab exercises only
- Keep recommendations evidence-based and conservative`;

  const clientProfile = JSON.stringify({
    name: client.name,
    program: client.program,
    intake: client.intake_data,
    week: week_no,
    recent_checkins: recentCheckins || [],
  });

  const userPrompt = `Generate Week ${week_no} program for this client:
${clientProfile}

Focus areas based on latest check-in: ${recentCheckins?.[0]?.next_week_focus || 'General progression'}
Issues reported: ${recentCheckins?.[0]?.issues || 'None'}
Compliance score: ${recentCheckins?.[0]?.compliance_score || 'N/A'}/10

Output valid JSON only.`;

  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  if (isSafetyViolation(programData)) {
    const { createEscalation } = require('../lib/escalation');
    await createEscalation(
      client.phone,
      'unsafe_program_generated',
      `Week ${week_no} program flagged for safety review`
    );
    return res.status(200).json({ action: 'flagged_for_review' });
  }

  const pdfBuffer = await generatePDF(client, week_no, programData);

  const filePath = `clients/${client_id}/week_${week_no}.pdf`;
  const { error: uploadError } = await db.storage
    .from('programs')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    console.error('PDF upload error:', uploadError);
  }

  const { data: urlData } = db.storage
    .from('programs')
    .getPublicUrl(filePath);

  const pdfUrl = urlData?.publicUrl || '';

  await db.from('programs').insert({
    client_id,
    week_no,
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
  });

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    programLabel(client.program),
  ], pdfUrl);

  await db
    .from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ action: 'program_generated', week_no, pdf_url: pdfUrl });
};

function isSafetyViolation(programData) {
  const np = programData?.nutrition_plan;
  if (!np) return false;
  if (np.daily_calories && np.daily_calories < 1200) return true;
  const mealText = JSON.stringify(np).toLowerCase();
  const banned = ['dnp', 'clenbuterol', 'ephedra', 'sarm', 'steroid'];
  return banned.some((b) => mealText.includes(b));
}

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fillColor('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fillColor('#FFFFFF').fontSize(14).text(
      `Week ${weekNo} Program — ${programLabel(client.program)}`,
      50, 75, { align: 'center' }
    );
    doc.fillColor('#999999').fontSize(10).text(
      `Prepared for ${client.name || 'Client'} | ${new Date().toLocaleDateString()}`,
      50, 95, { align: 'center' }
    );

    doc.moveDown(3);

    doc.fillColor('#2C2C2C').fontSize(20).text('WORKOUT PLAN', { underline: true });
    doc.moveDown(0.5);

    const wp = programData.workout_plan || {};
    for (const [day, exercises] of Object.entries(wp)) {
      doc.fillColor('#B8965A').fontSize(14).text(day.replace(/_/g, ' ').toUpperCase());
      doc.moveDown(0.3);

      if (Array.isArray(exercises)) {
        exercises.forEach((ex) => {
          doc.fillColor('#2C2C2C').fontSize(10).text(
            `  ${ex.name} — ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}`,
            { indent: 20 }
          );
          if (ex.notes) {
            doc.fillColor('#6B6B6B').fontSize(8).text(`    ${ex.notes}`, { indent: 30 });
          }
        });
      }
      doc.moveDown(0.5);
    }

    if (doc.y > doc.page.height - 300) doc.addPage();

    doc.moveDown(1);
    doc.fillColor('#2C2C2C').fontSize(20).text('NUTRITION PLAN', { underline: true });
    doc.moveDown(0.5);

    const np = programData.nutrition_plan || {};
    doc.fillColor('#B8965A').fontSize(12).text(
      `Daily Target: ${np.daily_calories || '—'} kcal | P: ${np.protein_g || '—'}g | C: ${np.carbs_g || '—'}g | F: ${np.fats_g || '—'}g`
    );
    doc.moveDown(0.5);

    if (Array.isArray(np.meals)) {
      np.meals.forEach((meal) => {
        doc.fillColor('#2C2C2C').fontSize(11).text(`${meal.meal} (~${meal.approx_calories} kcal)`);
        doc.fillColor('#6B6B6B').fontSize(9).text(`  ${meal.description}`, { indent: 20 });
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(2);
    doc.fillColor('#999999').fontSize(8).text(
      'This program is personalised for you. Do not share. Consult a physician before starting any exercise program.',
      { align: 'center' }
    );

    doc.end();
  });
}
