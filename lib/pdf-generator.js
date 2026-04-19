const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  charcoal: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

async function generateProgramPDF(program, clientName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 100;

    doc.rect(0, 0, doc.page.width, 100).fill(BRAND.charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30, { width: pageWidth });
    doc.fontSize(12).fill(BRAND.gold)
      .text(`WEEK ${program.week_no} PROGRAM`, 50, 65, { width: pageWidth });
    doc.fontSize(10).fill('#FFFFFF')
      .text(clientName || 'Client', 50, 82, { width: pageWidth, align: 'right' });

    doc.moveDown(3);

    const workout = program.workout_plan;
    if (workout) {
      doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50);
      doc.moveTo(50, doc.y + 4).lineTo(50 + pageWidth, doc.y + 4)
        .strokeColor(BRAND.gold).lineWidth(2).stroke();
      doc.moveDown(0.8);

      if (workout.overview) {
        doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
          .text(workout.overview, 50, doc.y, { width: pageWidth });
        doc.moveDown(0.8);
      }

      if (workout.days) {
        for (const day of workout.days) {
          if (doc.y > 680) doc.addPage();

          doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
            .text(day.day, 50);
          doc.moveDown(0.3);

          if (day.warmup) {
            doc.fontSize(9).fill(BRAND.midGrey).font('Helvetica')
              .text(`Warm-up: ${day.warmup}`, 60);
          }
          doc.moveDown(0.3);

          if (day.exercises) {
            for (const ex of day.exercises) {
              doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
                .text(`${ex.name}`, 60, doc.y, { continued: true })
                .font('Helvetica').fill(BRAND.midGrey)
                .text(`  —  ${ex.sets} sets x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`, { width: pageWidth - 20 });
            }
          }

          if (day.cooldown) {
            doc.moveDown(0.2);
            doc.fontSize(9).fill(BRAND.midGrey).font('Helvetica')
              .text(`Cool-down: ${day.cooldown}`, 60);
          }
          doc.moveDown(0.6);
        }
      }

      if (workout.cardio) {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text('Cardio: ', 50, doc.y, { continued: true })
          .font('Helvetica').fill(BRAND.midGrey)
          .text(workout.cardio);
        doc.moveDown(0.3);
      }

      if (workout.rest_days) {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text('Rest Days: ', 50, doc.y, { continued: true })
          .font('Helvetica').fill(BRAND.midGrey)
          .text(workout.rest_days);
      }
    }

    doc.addPage();

    const nutrition = program.nutrition_plan;
    if (nutrition) {
      doc.rect(0, 0, doc.page.width, 60).fill(BRAND.charcoal);
      doc.fontSize(18).fill('#FFFFFF').font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50, 20, { width: pageWidth });

      doc.moveDown(3);

      if (nutrition.daily_calories) {
        doc.fontSize(14).fill(BRAND.gold).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.daily_calories} calories`, 50);
        doc.moveDown(0.4);
      }

      if (nutrition.macros) {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
          .text(`Protein: ${nutrition.macros.protein_g}g  |  Carbs: ${nutrition.macros.carbs_g}g  |  Fats: ${nutrition.macros.fats_g}g`, 50);
        doc.moveDown(0.8);
      }

      doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y)
        .strokeColor(BRAND.lightGrey).lineWidth(1).stroke();
      doc.moveDown(0.6);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(12).fill(BRAND.charcoal).font('Helvetica-Bold')
            .text(meal.meal, 50);
          doc.moveDown(0.2);

          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
                .text(`→  ${opt}`, 60, doc.y, { width: pageWidth - 20 });
            }
          }
          doc.moveDown(0.5);
        }
      }

      if (nutrition.supplements?.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(12).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text('Supplements', 50);
        doc.moveDown(0.2);
        for (const sup of nutrition.supplements) {
          doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
            .text(`→  ${sup}`, 60);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text('Hydration: ', 50, doc.y, { continued: true })
          .font('Helvetica').fill(BRAND.midGrey)
          .text(nutrition.hydration);
      }
    }

    if (program.notes) {
      doc.moveDown(1.5);
      doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y)
        .strokeColor(BRAND.gold).lineWidth(1).stroke();
      doc.moveDown(0.6);
      doc.fontSize(12).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text("COACH'S NOTES", 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(program.notes, 50, doc.y, { width: pageWidth });
    }

    const bottomY = doc.page.height - 40;
    doc.fontSize(8).fill(BRAND.midGrey).font('Helvetica')
      .text('fitnessbymaddy.com  |  @fitnessbymaddy_  |  This program is for personal use only.', 50, bottomY, {
        width: pageWidth,
        align: 'center'
      });

    doc.end();
  });
}

async function uploadPDF(buffer, clientId, weekNo) {
  const path = `clients/${clientId}/week_${weekNo}.pdf`;

  const { error } = await supabase.storage
    .from('programs')
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from('programs')
    .getPublicUrl(path);

  await supabase
    .from('programs')
    .update({ pdf_url: publicUrl })
    .eq('client_id', clientId)
    .eq('week_no', weekNo);

  return publicUrl;
}

module.exports = { generateProgramPDF, uploadPDF };
