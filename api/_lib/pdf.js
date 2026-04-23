const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const COLORS = {
  black: '#1a1a1a',
  gold: '#B8965A',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  cream: '#FAF8F4',
  white: '#FFFFFF'
};

function buildPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Header bar ---
    doc.rect(0, 0, 595.28, 80).fill(COLORS.black);
    doc.fontSize(28).fill(COLORS.gold)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(COLORS.white)
      .font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 55, { characterSpacing: 1 });

    // --- Client info ---
    doc.moveDown(2);
    doc.y = 110;
    doc.fontSize(11).fill(COLORS.grey).font('Helvetica')
      .text(`Prepared for: ${clientName}`, 50);
    doc.fontSize(11).fill(COLORS.grey)
      .text(`Week: ${weekNo}  |  Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    // --- Gold divider ---
    doc.moveTo(50, doc.y + 15).lineTo(545, doc.y + 15)
      .strokeColor(COLORS.gold).lineWidth(2).stroke();

    // --- Workout Plan ---
    doc.y += 30;
    doc.fontSize(18).fill(COLORS.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workoutPlan && Array.isArray(workoutPlan.days)) {
      for (const day of workoutPlan.days) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).fill(COLORS.gold).font('Helvetica-Bold')
          .text(day.name || day.day, 50);
        doc.moveDown(0.3);

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            if (doc.y > 730) doc.addPage();
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}` +
              (ex.rest ? `  (Rest: ${ex.rest})` : '') +
              (ex.notes ? `  [${ex.notes}]` : '');
            doc.fontSize(10).fill(COLORS.black).font('Helvetica')
              .text(`  •  ${line}`, 60, doc.y, { width: 480 });
            doc.moveDown(0.2);
          }
        }

        if (day.notes) {
          doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
            .text(`     Note: ${day.notes}`, 60);
        }
        doc.moveDown(0.8);
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fill(COLORS.black).font('Helvetica')
        .text(workoutPlan, 60, doc.y, { width: 480 });
      doc.moveDown(1);
    }

    // --- Nutrition Plan ---
    if (doc.y > 600) doc.addPage();
    doc.moveTo(50, doc.y).lineTo(545, doc.y)
      .strokeColor(COLORS.lightGrey).lineWidth(1).stroke();
    doc.y += 20;

    doc.fontSize(18).fill(COLORS.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fill(COLORS.gold).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 60);
        doc.moveDown(0.3);
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fontSize(10).fill(COLORS.black).font('Helvetica')
          .text(`Protein: ${m.protein || '—'}g  |  Carbs: ${m.carbs || '—'}g  |  Fats: ${m.fats || '—'}g`, 60);
        doc.moveDown(0.5);
      }
      if (nutritionPlan.meals && Array.isArray(nutritionPlan.meals)) {
        for (const meal of nutritionPlan.meals) {
          if (doc.y > 730) doc.addPage();
          doc.fontSize(11).fill(COLORS.gold).font('Helvetica-Bold')
            .text(meal.name, 60);
          doc.fontSize(10).fill(COLORS.black).font('Helvetica')
            .text(meal.description || meal.items || '', 70, doc.y, { width: 470 });
          doc.moveDown(0.5);
        }
      }
      if (nutritionPlan.notes) {
        doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
          .text(nutritionPlan.notes, 60, doc.y, { width: 480 });
        doc.moveDown(0.5);
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fill(COLORS.black).font('Helvetica')
        .text(nutritionPlan, 60, doc.y, { width: 480 });
      doc.moveDown(1);
    }

    // --- Coach Notes ---
    if (notes) {
      if (doc.y > 650) doc.addPage();
      doc.moveTo(50, doc.y + 10).lineTo(545, doc.y + 10)
        .strokeColor(COLORS.lightGrey).lineWidth(1).stroke();
      doc.y += 25;
      doc.fontSize(14).fill(COLORS.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(COLORS.grey).font('Helvetica')
        .text(notes, 60, doc.y, { width: 480 });
    }

    // --- Footer ---
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(COLORS.grey).font('Helvetica')
        .text('fitnessbymaddy.com  |  Confidential — prepared exclusively for you',
          50, 780, { align: 'center', width: 495 });
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
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = db.storage.from('clients').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { buildPDF, uploadPDF };
