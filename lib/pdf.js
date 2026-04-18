const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  charcoal: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    doc.moveDown(2);
    doc.y = 100;

    // Client info
    doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
      .text(`Client: ${client.name || 'N/A'}  |  Program: ${client.program}  |  Week ${weekNo}`, 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 495, 1).fill(BRAND.lightGrey);
    doc.moveDown(1);

    // Workout section
    doc.fontSize(16).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 40, 3).fill(BRAND.gold);
    doc.moveDown(0.8);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(12).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text(day.name, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
              .text(`  →  ${ex.name}  —  ${ex.sets}x${ex.reps}  ${ex.notes || ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(JSON.stringify(workout, null, 2), 50);
    }

    // Nutrition section
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(16).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 40, 3).fill(BRAND.gold);
    doc.moveDown(0.8);

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(11).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text(meal.name, 50);
        doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
          .text(meal.description || meal.items?.join(', ') || '', 60);
        if (meal.macros) {
          doc.fontSize(9).fill(BRAND.gold)
            .text(`P: ${meal.macros.protein}g  |  C: ${meal.macros.carbs}g  |  F: ${meal.macros.fat}g`, 60);
        }
        doc.moveDown(0.4);
      }

      if (nutrition.dailyTotals) {
        doc.moveDown(0.5);
        doc.rect(50, doc.y, 495, 1).fill(BRAND.lightGrey);
        doc.moveDown(0.5);
        doc.fontSize(11).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text(`Daily Totals: ${nutrition.dailyTotals.calories} kcal  |  P: ${nutrition.dailyTotals.protein}g  |  C: ${nutrition.dailyTotals.carbs}g  |  F: ${nutrition.dailyTotals.fat}g`, 50);
      }
    } else {
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(JSON.stringify(nutrition, null, 2), 50);
    }

    // Notes
    if (notes) {
      doc.moveDown(1.5);
      doc.fontSize(12).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const pageH = doc.page.height;
    doc.rect(0, pageH - 40, 595, 40).fill(BRAND.charcoal);
    doc.fontSize(8).fill(BRAND.gold)
      .text('fitnessbymaddy.com  |  @fitnessbymaddy_', 50, pageH - 28, { width: 495, align: 'center' });

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const path = `${clientId}/week_${weekNo}.pdf`;
  const { data, error } = await supabase.storage
    .from('clients')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('clients')
    .getPublicUrl(path);

  return urlData.publicUrl;
}

module.exports = { generateProgramPDF, uploadPDF };
