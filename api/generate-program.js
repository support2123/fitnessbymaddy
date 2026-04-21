const { supabase } = require('../lib/supabase');
const { generateWeeklyProgram } = require('../lib/program-generator');
const { sendMediaMessage, sendTemplate } = require('../lib/whatsapp');
const { sendJson, parseBody, maskPhone } = require('../lib/utils');
const { escalate } = require('../lib/escalation');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return sendJson(res, 400, { error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return sendJson(res, 404, { error: 'Client not found' });

    console.log(`[PROGRAM] Generating Week ${week_no} for ${maskPhone(client.phone)}`);

    const { program, flagged } = await generateWeeklyProgram(client_id, parseInt(week_no));

    if (flagged) {
      await escalate(
        client.phone,
        'Program flagged for safety review',
        `Week ${week_no} program contains potentially unsafe recommendations`
      );
      return sendJson(res, 200, {
        success: true,
        flagged: true,
        message: 'Program generated but flagged for Maddy review',
        program_id: program.id,
      });
    }

    const pdfBuffer = await renderProgramPdf(client, program, parseInt(week_no));

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl;

    await supabase.from('programs').update({ pdf_url: pdfUrl }).eq('id', program.id);

    const waResult = await sendMediaMessage(
      client.phone,
      pdfUrl,
      `Week ${week_no} program is ready! Check your personalized plan inside.`
    );

    if (waResult.ok) {
      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }

    return sendJson(res, 200, {
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
      whatsapp_sent: waResult.ok,
    });
  } catch (err) {
    console.error('[PROGRAM] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};

function renderProgramPdf(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 50, 75, { align: 'center' });

    doc.moveDown(3);

    const workout = program.workout_plan;
    if (workout && workout.days) {
      doc.fill('#2C2C2C').fontSize(20).font('Helvetica-Bold').text('WORKOUT PLAN');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
      doc.moveDown(0.5);

      for (const day of workout.days) {
        if (doc.y > 680) { doc.addPage(); doc.moveDown(1); }

        doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus || ''}`);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(`• ${ex.name}  —  ${ex.sets} x ${ex.reps}  (Rest: ${ex.rest || '60s'})${ex.notes ? '  ' + ex.notes : ''}`, { indent: 15 });
          }
        }

        if (day.cooldown) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`);
        }

        doc.moveDown(0.5);
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(20).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 20, { align: 'center' });
    doc.moveDown(2);

    const nutrition = program.nutrition_plan;
    if (nutrition) {
      doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
        .text('Daily Targets:');
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica')
        .text(`Calories: ${nutrition.calories || '—'} kcal  |  Protein: ${nutrition.protein_g || '—'}g  |  Carbs: ${nutrition.carbs_g || '—'}g  |  Fat: ${nutrition.fat_g || '—'}g`);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
            .text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
                .text(`• ${opt}`, { indent: 15 });
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.notes) {
        doc.moveDown(0.5);
        doc.fill('#6B6B6B').fontSize(10).font('Helvetica-Oblique')
          .text(nutrition.notes);
      }
    }

    if (program.notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fill('#2C2C2C').fontSize(11).font('Helvetica-Bold')
        .text('Coach Notes:');
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
        .text(program.notes);
    }

    doc.end();
  });
}
