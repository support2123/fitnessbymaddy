const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { buildProgramPrompt, validateProgramOutput } = require('../lib/program-prompt');
const { cors, maskPhone } = require('../lib/helpers');
const { sendText, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { client_id } = req.body;
  if (!client_id) return res.status(400).json({ error: 'Missing client_id' });

  const db = getSupabase();

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

  const lastWeek = checkins?.[0]?.week_no || 0;
  const nextWeek = lastWeek + 1;

  const { data: existingProgram } = await db
    .from('programs')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', nextWeek)
    .single();

  if (existingProgram) {
    return res.json({ ok: true, message: 'Program already exists for this week', week: nextWeek });
  }

  const prompt = buildProgramPrompt(client, checkins || []);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  let programData;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    programData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }

  const validation = validateProgramOutput(programData);
  if (!validation.safe) {
    await notifyMaddy(
      'Program flagged for review',
      `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${nextWeek}\nFlags: ${validation.flags.join(', ')}`
    );
    return res.json({ ok: false, message: 'Program flagged for review', flags: validation.flags });
  }

  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(client, nextWeek, programData);
  } catch (err) {
    console.error('PDF generation error:', err.message);
    return res.status(500).json({ error: 'PDF generation failed' });
  }

  const pdfPath = `clients/${client_id}/week_${nextWeek}.pdf`;
  const { error: uploadErr } = await db.storage
    .from('programs')
    .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

  if (uploadErr) {
    console.error('Upload error:', uploadErr.message);
    return res.status(500).json({ error: 'PDF upload failed' });
  }

  const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
  const pdfUrl = urlData?.publicUrl || pdfPath;

  const { data: program } = await db.from('programs').insert({
    client_id,
    week_no: nextWeek,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.coach_notes || null
  }).select().single();

  const coachNote = programData.coach_notes || `Your Week ${nextWeek} program is ready!`;
  await sendText(client.phone, `${coachNote}\n\nDownload your program: ${pdfUrl}`);

  await db.from('programs').update({
    whatsapp_sent_at: new Date().toISOString()
  }).eq('id', program.id);

  return res.json({ ok: true, program_id: program.id, week: nextWeek, pdf_url: pdfUrl });
};

function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const gold = '#B8965A';
      const charcoal = '#2C2C2C';

      doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
      doc.fontSize(28).fillColor(gold).text('FITNESS BY MADDY', 50, 35, { align: 'left' });
      doc.fontSize(12).fillColor('#FFFFFF')
        .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'left' });
      doc.fontSize(9).fillColor('#999999')
        .text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 95);

      doc.moveDown(3);

      if (data.workout_plan?.days) {
        doc.fontSize(18).fillColor(gold).text('WORKOUT PLAN', 50);
        doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(gold).lineWidth(1).stroke();
        doc.moveDown(0.8);

        if (data.workout_plan.weekly_notes) {
          doc.fontSize(10).fillColor('#666666').text(data.workout_plan.weekly_notes, 50, doc.y, { width: 495 });
          doc.moveDown(0.5);
        }

        for (const day of data.workout_plan.days) {
          if (doc.y > 680) { doc.addPage(); }

          doc.fontSize(13).fillColor(charcoal).text(day.day, 50);
          if (day.warmup) {
            doc.fontSize(9).fillColor('#888888').text(`Warmup: ${day.warmup}`, 60);
          }
          doc.moveDown(0.3);

          for (const ex of (day.exercises || [])) {
            const line = `${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`;
            doc.fontSize(10).fillColor('#333333').text(line, 70, doc.y, { width: 475 });
            if (ex.notes) {
              doc.fontSize(8).fillColor('#999999').text(`  ${ex.notes}`, 80);
            }
          }

          if (day.cooldown) {
            doc.fontSize(9).fillColor('#888888').text(`Cooldown: ${day.cooldown}`, 60);
          }
          doc.moveDown(0.6);
        }
      }

      if (data.nutrition_plan) {
        if (doc.y > 550) { doc.addPage(); }

        doc.moveDown(1);
        doc.fontSize(18).fillColor(gold).text('NUTRITION PLAN', 50);
        doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(gold).lineWidth(1).stroke();
        doc.moveDown(0.8);

        const np = data.nutrition_plan;
        doc.fontSize(11).fillColor(charcoal)
          .text(`Daily Calories: ${np.calories} kcal   |   Protein: ${np.protein_g}g   |   Carbs: ${np.carbs_g}g   |   Fat: ${np.fat_g}g`, 50);
        doc.moveDown(0.5);

        if (np.hydration) {
          doc.fontSize(10).fillColor('#666666').text(`Hydration: ${np.hydration}`, 50);
        }
        doc.moveDown(0.5);

        for (const meal of (np.meals || [])) {
          doc.fontSize(11).fillColor(charcoal).text(`${meal.meal} (${meal.time || ''})`, 60);
          doc.fontSize(10).fillColor('#555555').text(meal.description, 70, doc.y, { width: 475 });
          doc.moveDown(0.3);
        }

        if (np.notes) {
          doc.moveDown(0.3);
          doc.fontSize(9).fillColor('#888888').text(np.notes, 50, doc.y, { width: 495 });
        }
      }

      const bottomY = doc.page.height - 40;
      doc.fontSize(8).fillColor('#BBBBBB')
        .text('Fitness by Maddy | fitnessbymaddy.com | This program is for personal use only.', 50, bottomY, { align: 'center', width: 495 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
