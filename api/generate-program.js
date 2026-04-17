const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { PROGRAM_META } = require('./_lib/helpers');
const { notifyMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories',
  'below 800 calories',
  'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarms',
  'lose 10 kg in 1 week',
  'lose 20 pounds in 2 weeks',
  'starvation',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeMsg } = await db
      .from('messages')
      .select('body')
      .eq('phone', client.phone)
      .eq('template_name', 'intake_form')
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    let intakeData = {};
    if (intakeMsg && intakeMsg.body) {
      try {
        const jsonStr = intakeMsg.body.replace('INTAKE FORM: ', '');
        intakeData = JSON.parse(jsonStr);
      } catch (_) {}
    }

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness coach and nutritionist working for FitnessByMaddy.
Generate a detailed, personalised weekly training and nutrition plan.

RULES:
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend banned substances or supplements without evidence
- Never promise unrealistic timelines (max 0.5-1kg fat loss per week)
- Consider injuries, medical conditions, and preferences
- Be specific: exact exercises, sets, reps, rest periods
- Include warm-up and cool-down
- Nutrition: macros, meal timing, hydration targets
- Output valid JSON with keys: workout_plan, nutrition_plan, notes`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${PROGRAM_META[client.program]?.name || client.program}
Week: ${week_no}

Intake data: ${JSON.stringify(intakeData)}

Recent check-ins: ${JSON.stringify(checkins || [])}

Generate Week ${week_no} program. Return JSON only.`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await notifyMaddy('Program generation returned non-JSON', {
        clientName: client.name,
        phone: client.phone,
        message: `Week ${week_no} — could not parse AI response`,
      });
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some((f) => fullText.includes(f));

    if (flagged) {
      await notifyMaddy('Program flagged for safety review', {
        clientName: client.name,
        phone: client.phone,
        message: `Week ${week_no} program contains risky content — held for review`,
      });

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED FOR REVIEW: ' + (programData.notes || ''),
      });

      return res.status(200).json({ success: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[generate-program] Upload error:', uploadErr);
    }

    const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes || null,
      })
      .select()
      .single();

    const msg = `Your Week ${week_no} program is ready! 🔥\n\nCheck your PDF for the full plan. Let's make this week count!`;
    await sendTemplate(client.phone, 'program_ready', [msg]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, programId: program.id });
  } catch (err) {
    console.error('[generate-program]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');

    doc.font('Helvetica-Bold').fontSize(28).fillColor('#B8965A');
    doc.text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.font('Helvetica').fontSize(14).fillColor('#FFFFFF');
    doc.text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, {
      align: 'center',
    });

    doc.fillColor('#2C2C2C');
    let y = 150;

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#B8965A');
    doc.text('WORKOUT PLAN', 50, y);
    y += 35;

    doc.font('Helvetica').fontSize(11).fillColor('#2C2C2C');
    const workoutText =
      typeof programData.workout_plan === 'string'
        ? programData.workout_plan
        : JSON.stringify(programData.workout_plan, null, 2);
    doc.text(workoutText, 50, y, { width: 495 });
    y = doc.y + 30;

    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#B8965A');
    doc.text('NUTRITION PLAN', 50, y);
    y += 35;

    doc.font('Helvetica').fontSize(11).fillColor('#2C2C2C');
    const nutritionText =
      typeof programData.nutrition_plan === 'string'
        ? programData.nutrition_plan
        : JSON.stringify(programData.nutrition_plan, null, 2);
    doc.text(nutritionText, 50, y, { width: 495 });
    y = doc.y + 30;

    if (programData.notes) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#B8965A');
      doc.text('NOTES', 50, y);
      y += 25;
      doc.font('Helvetica').fontSize(11).fillColor('#6B6B6B');
      doc.text(programData.notes, 50, y, { width: 495 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#C8B89A')
        .text('fitnessbymaddy.com', 50, doc.page.height - 40, {
          align: 'center',
          width: 495,
        });
    }

    doc.end();
  });
}
