const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.goldLight)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text(`Client: ${clientName}`, 50);
    doc.fontSize(11).fill(BRAND.grey)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);

    // Workout Plan
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (workoutPlan && Array.isArray(workoutPlan.days)) {
      for (const day of workoutPlan.days) {
        doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || day.day, 50, doc.y);
        doc.moveDown(0.3);

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`;
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(`  ${line.trim()}`, 60, doc.y);
          }
        } else if (day.description) {
          doc.fontSize(10).fill(BRAND.black).font('Helvetica')
            .text(`  ${day.description}`, 60, doc.y);
        }
        doc.moveDown(0.5);

        if (doc.y > 720) {
          doc.addPage();
        }
      }
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, 595, 4).fill(BRAND.gold);
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 30, { characterSpacing: 2 });
    doc.moveDown(1);

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50);
        doc.moveDown(0.3);
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${m.protein || '—'}g  |  Carbs: ${m.carbs || '—'}g  |  Fat: ${m.fat || '—'}g`, 50);
        doc.moveDown(0.5);
      }
      if (nutritionPlan.meals && Array.isArray(nutritionPlan.meals)) {
        for (const meal of nutritionPlan.meals) {
          doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50, doc.y);
          doc.moveDown(0.2);
          if (Array.isArray(meal.items)) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.black).font('Helvetica')
                .text(`  • ${item}`, 60, doc.y);
            }
          }
          doc.moveDown(0.5);
        }
      }
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
      doc.moveDown(0.5);
      doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
        .text('fitnessbymaddy.com  |  Confidential — Do not share', 50, 790, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
