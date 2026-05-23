const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text(`Prepared for: ${clientName}`, 50);
    doc.fontSize(11).fill(BRAND.grey)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50);

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(BRAND.lightGrey);

    // Workout Plan
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, undefined, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || day.day, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(`  ${ex.name}`, 60, undefined, { continued: true });
            doc.fill(BRAND.grey)
              .text(`  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, { continued: false });
          }
        }

        if (day.notes) {
          doc.fontSize(9).fill(BRAND.grey).font('Helvetica-Oblique')
            .text(`  Note: ${day.notes}`, 60);
        }
        doc.moveDown(0.5);
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fill(BRAND.black).font('Helvetica')
        .text(workoutPlan, 50);
    }

    // Nutrition Plan
    if (doc.y > doc.page.height - 250) doc.addPage();

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(BRAND.lightGrey);
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, undefined, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (nutritionPlan && nutritionPlan.meals) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal | P: ${nutritionPlan.protein || '—'}g | C: ${nutritionPlan.carbs || '—'}g | F: ${nutritionPlan.fats || '—'}g`, 50);
        doc.moveDown(0.5);
      }
      for (const meal of nutritionPlan.meals) {
        doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
          .text(meal.name || meal.meal, 50);
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(meal.description || meal.items?.join(', ') || '', 60);
        doc.moveDown(0.3);
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fill(BRAND.black).font('Helvetica')
        .text(nutritionPlan, 50);
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(BRAND.lightGrey);
      doc.moveDown(0.5);
      doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, undefined, { characterSpacing: 2 });
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50);
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
      .text('fitnessbymaddy.com | support@fitnessbymaddy.com', 50, footerY, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
