const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#9A9A9A',
  cream: '#FAF8F4'
};

async function generateProgramPDF(clientId, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);

    doc.rect(40, 30, doc.page.width - 80, 4).fill(BRAND.gold);

    doc.fillColor(BRAND.gold)
      .fontSize(32)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 60, { align: 'center' });

    doc.fillColor(BRAND.white)
      .fontSize(18)
      .font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 100, { align: 'center' });

    doc.rect(40, 130, doc.page.width - 80, 1).fill(BRAND.gold);

    let y = 155;

    if (workoutPlan) {
      doc.fillColor(BRAND.gold)
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50, y);
      y += 30;

      const days = Array.isArray(workoutPlan) ? workoutPlan : workoutPlan.days || [];
      for (const day of days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
          y = 50;
        }

        doc.fillColor(BRAND.goldLight)
          .fontSize(13)
          .font('Helvetica-Bold')
          .text(day.name || day.day || '', 50, y);
        y += 20;

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
            y = 50;
          }

          const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest ? `(${ex.rest} rest)` : ''}`;
          doc.fillColor(BRAND.white)
            .fontSize(10)
            .font('Helvetica')
            .text(line, 65, y, { width: 450 });
          y += 16;

          if (ex.notes) {
            doc.fillColor(BRAND.grey)
              .fontSize(9)
              .text(ex.notes, 75, y, { width: 440 });
            y += 14;
          }
        }
        y += 10;
      }
    }

    if (nutritionPlan) {
      if (y > 550) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
        y = 50;
      }

      y += 10;
      doc.fillColor(BRAND.gold)
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50, y);
      y += 30;

      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fillColor(BRAND.goldLight)
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(`Daily Target: ${m.calories || '—'} kcal  |  P: ${m.protein || '—'}g  |  C: ${m.carbs || '—'}g  |  F: ${m.fat || '—'}g`, 50, y);
        y += 25;
      }

      const meals = nutritionPlan.meals || [];
      for (const meal of meals) {
        if (y > 720) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
          y = 50;
        }

        doc.fillColor(BRAND.goldLight)
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(meal.name || '', 50, y);
        y += 18;

        const items = meal.items || [];
        for (const item of items) {
          doc.fillColor(BRAND.white)
            .fontSize(10)
            .font('Helvetica')
            .text(`• ${item}`, 65, y, { width: 450 });
          y += 15;
        }
        y += 8;
      }

      if (nutritionPlan.notes) {
        y += 5;
        doc.fillColor(BRAND.grey)
          .fontSize(9)
          .font('Helvetica')
          .text(nutritionPlan.notes, 50, y, { width: 480 });
      }
    }

    if (notes) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
      doc.fillColor(BRAND.gold)
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('COACH NOTES', 50, 50);
      doc.fillColor(BRAND.white)
        .fontSize(11)
        .font('Helvetica')
        .text(notes, 50, 80, { width: 480 });
    }

    const lastPage = doc.bufferedPageRange();
    doc.fillColor(BRAND.grey)
      .fontSize(8)
      .text('fitnessbymaddy.com | Personalised. Progressive. Proven.',
        50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getSupabase();
  const path = `${clientId}/week_${weekNo}.pdf`;

  const { data, error } = await db.storage
    .from('clients')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data: urlData } = await db.storage
    .from('clients')
    .createSignedUrl(path, 60 * 60 * 24 * 30);

  return urlData?.signedUrl || null;
}

module.exports = { generateProgramPDF, uploadPDF };
