const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { parseBody, json } = require('./lib/helpers');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'anabolic', 'steroid', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const { client_id, week_no } = await parseBody(req);
  if (!client_id || !week_no) {
    return json(res, 400, { error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return json(res, 404, { error: 'client not found' });

  const { data: checkins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: lead } = client.lead_id
    ? await db.from('leads').select('intake_data').eq('id', client.lead_id).single()
    : { data: null };

  const prompt = buildPrompt(client, checkins || [], lead?.intake_data, week_no);

  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const claudeData = await claudeResp.json();
  const rawOutput = claudeData.content?.[0]?.text || '';

  const lowerOutput = rawOutput.toLowerCase();
  const flagged = SAFETY_FLAGS.some(f => lowerOutput.includes(f));
  if (flagged) {
    await notifyMaddy(
      'Program flagged for review',
      `Client ${maskPhone(client.phone)}, Week ${week_no} — contains potentially unsafe content`
    );
    return json(res, 200, { action: 'flagged-for-review', client_id, week_no });
  }

  let parsed;
  try {
    const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawOutput);
  } catch {
    parsed = { workout_plan: rawOutput, nutrition_plan: '' };
  }

  const pdfBuffer = await generatePDF(client, week_no, parsed);

  const filePath = `clients/${client_id}/week_${week_no}.pdf`;
  await db.storage.from('programs').upload(filePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
  const pdfUrl = urlData?.publicUrl || filePath;

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: parsed.workout_plan || parsed,
    nutrition_plan: parsed.nutrition_plan || null,
    notes: parsed.notes || null,
  }).select().single();

  await sendWhatsApp(client.phone, 'weekly_program', [
    client.name || 'there',
    `Week ${week_no}`,
    pdfUrl,
  ]);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString(),
  }).eq('id', program.id);

  return json(res, 200, { success: true, program_id: program.id, pdf_url: pdfUrl });
};

function buildPrompt(client, checkins, intake, weekNo) {
  const parts = [
    'You are an expert fitness coach creating a weekly training and nutrition program.',
    'Return your response as a JSON object with keys: workout_plan, nutrition_plan, notes.',
    '',
    `Client: ${client.name || 'Anonymous'}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`,
  ];

  if (intake) {
    parts.push('', 'Client Profile:', JSON.stringify(intake, null, 2));
  }

  if (checkins.length > 0) {
    parts.push('', 'Recent Check-ins:');
    checkins.forEach(c => {
      parts.push(`  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`);
    });
  }

  parts.push(
    '',
    'Guidelines:',
    '- Provide 5-6 training days with exercises, sets, reps, rest periods',
    '- Include warm-up and cool-down',
    '- Nutrition: daily macros, meal timing, 3-4 meal options per meal',
    '- Adjust based on check-in data (compliance, energy, weight trend)',
    '- Be specific with exercise names and progressions',
    '- Keep calories reasonable (never below 1200 for women, 1500 for men)',
    '- No banned substances or extreme protocols',
    '- Use a warm, professional tone',
  );

  return parts.join('\n');
}

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 72, { align: 'center' });
    doc.fontSize(10).fillColor('#D4AF7A')
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 94, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(16).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50, 150);
    doc.moveTo(50, 170).lineTo(545, 170).strokeColor('#B8965A').lineWidth(1).stroke();
    doc.moveDown(0.5);

    const workoutText = typeof plan.workout_plan === 'string'
      ? plan.workout_plan
      : JSON.stringify(plan.workout_plan, null, 2);
    doc.fontSize(10).fillColor('#333333')
      .text(workoutText, 50, 180, { width: 495, lineGap: 4 });

    if (plan.nutrition_plan) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
      doc.fontSize(14).fillColor('#B8965A')
        .text('NUTRITION PLAN', 50, 20, { align: 'center' });

      const nutritionText = typeof plan.nutrition_plan === 'string'
        ? plan.nutrition_plan
        : JSON.stringify(plan.nutrition_plan, null, 2);
      doc.fontSize(10).fillColor('#333333')
        .text(nutritionText, 50, 80, { width: 495, lineGap: 4 });
    }

    if (plan.notes) {
      doc.moveDown(2);
      doc.fontSize(12).fillColor('#2C2C2C').text('COACH NOTES');
      doc.fontSize(10).fillColor('#6B6B6B')
        .text(plan.notes, { width: 495, lineGap: 4 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#999999')
        .text(
          `fitnessbymaddy.com | Page ${i + 1} of ${pageCount}`,
          50, doc.page.height - 30,
          { align: 'center', width: 495 }
        );
    }

    doc.end();
  });
}
