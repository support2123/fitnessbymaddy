const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function buildProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(28).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fillColor('#ffffff').text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fillColor(BRAND.black);
    doc.fontSize(12).text(`Client: ${clientName}`, 50, 100);
    doc.fontSize(10).fillColor(BRAND.grey).text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 118);

    // Divider
    doc.moveTo(50, 140).lineTo(545, 140).strokeColor(BRAND.gold).lineWidth(2).stroke();

    // Workout Plan
    let y = 160;
    doc.fontSize(18).fillColor(BRAND.gold).text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(13).fillColor(BRAND.black).text(day.name || day.day, 50, y, { underline: true });
        y += 20;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fillColor(BRAND.grey)
              .text(`• ${ex.name} — ${ex.sets}x${ex.reps} ${ex.rest ? '(Rest: ' + ex.rest + ')' : ''}`, 65, y);
            y += 16;
          }
        }
        if (day.notes) {
          doc.fontSize(9).fillColor(BRAND.grey).text(`  Note: ${day.notes}`, 65, y);
          y += 16;
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    y += 10;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.gold).lineWidth(1).stroke();
    y += 20;
    doc.fontSize(18).fillColor(BRAND.gold).text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fillColor(BRAND.black).text(`Daily Target: ${nutritionPlan.calories} kcal`, 50, y);
        y += 18;
      }
      if (nutritionPlan.macros) {
        doc.fontSize(10).fillColor(BRAND.grey)
          .text(`Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fats: ${nutritionPlan.macros.fats}g`, 50, y);
        y += 24;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(11).fillColor(BRAND.black).text(meal.name, 50, y);
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fillColor(BRAND.grey).text(`  • ${item}`, 65, y);
              y += 14;
            }
          }
          y += 8;
        }
      }
      if (nutritionPlan.notes) {
        doc.fontSize(9).fillColor(BRAND.grey).text(nutritionPlan.notes, 50, y, { width: 495 });
        y += 20;
      }
    }

    // Notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.gold).lineWidth(1).stroke();
      y += 20;
      doc.fontSize(14).fillColor(BRAND.gold).text('COACH NOTES', 50, y);
      y += 22;
      doc.fontSize(10).fillColor(BRAND.grey).text(notes, 50, y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(BRAND.grey)
        .text('fitnessbymaddy.com | Confidential — do not share', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getSupabase();
  const path = `${clientId}/week_${weekNo}.pdf`;

  const { error } = await db.storage
    .from('clients')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = db.storage.from('clients').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { buildProgramPDF, uploadPDF };
