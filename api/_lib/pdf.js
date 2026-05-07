const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 100).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fill(BRAND.goldLight).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 65);
    doc.fontSize(10).fill(BRAND.white)
      .text(client.name || 'Client', 400, 35, { align: 'right', width: 145 });
    doc.fontSize(9).fill(BRAND.goldLight)
      .text(client.program || '', 400, 52, { align: 'right', width: 145 });

    let y = 120;

    // Notes section
    if (notes) {
      doc.fontSize(10).fill(BRAND.gold).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 18;
      doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
      y += doc.heightOfString(notes, { width: 495 }) + 20;
    }

    // Workout Plan
    doc.rect(50, y, 495, 28).fill(BRAND.black);
    doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 60, y + 7);
    y += 40;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 22).fill('#F5F0E8');
        doc.fontSize(10).fill(BRAND.black).font('Helvetica-Bold')
          .text(day.name || day.day || 'Day', 60, y + 5);
        y += 28;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill(BRAND.black).font('Helvetica-Bold')
              .text(ex.name || ex.exercise || '', 60, y);
            doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
              .text(`${ex.sets || ''} x ${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 280, y);
            if (ex.notes) {
              y += 14;
              doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
                .text(ex.notes, 70, y, { width: 475 });
              y += doc.heightOfString(ex.notes, { width: 475 });
            }
            y += 16;
          }
        }
        y += 8;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }

    doc.rect(50, y, 495, 28).fill(BRAND.black);
    doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 60, y + 7);
    y += 40;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(10).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 60, y);
        y += 16;
        if (nutritionPlan.macros) {
          doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
            .text(`Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`, 60, y);
          y += 20;
        }
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.rect(50, y, 495, 20).fill('#F5F0E8');
          doc.fontSize(9).fill(BRAND.black).font('Helvetica-Bold')
            .text(meal.name || meal.meal || '', 60, y + 4);
          y += 26;

          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
                .text(`• ${item}`, 70, y, { width: 475 });
              y += 14;
            }
          }
          if (meal.notes) {
            doc.fontSize(8).fill(BRAND.gold).font('Helvetica')
              .text(meal.notes, 70, y, { width: 475 });
            y += 14;
          }
          y += 6;
        }
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.rect(0, 792, 595, 50).fill(BRAND.black);
      doc.fontSize(8).fill(BRAND.goldLight).font('Helvetica')
        .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 798);
      doc.text(`Page ${i + 1} of ${pageCount}`, 400, 798, { align: 'right', width: 145 });
    }

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, buffer) {
  const path = `${clientId}/week_${weekNo}.pdf`;
  const { data, error } = await supabase.storage
    .from('clients')
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from('clients')
    .getPublicUrl(path);

  return urlData?.publicUrl || path;
}

module.exports = { generateProgramPDF, uploadPDF };
