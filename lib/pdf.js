const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1A1A1A',
  gold: '#B8965A',
  darkGrey: '#2C2C2C',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  cream: '#FAF8F4',
  white: '#FFFFFF',
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(COLORS.black);
    doc.fontSize(28).fill(COLORS.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(COLORS.white).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(COLORS.midGrey).font('Helvetica')
      .text(`Prepared for: ${clientName}`, 50);
    doc.fontSize(11).fill(COLORS.midGrey)
      .text(`Week ${weekNo} · Generated ${new Date().toLocaleDateString('en-IN')}`, 50);

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(COLORS.lightGrey);

    // Workout section
    doc.moveDown(1);
    doc.fontSize(18).fill(COLORS.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, undefined, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(13).fill(COLORS.gold).font('Helvetica-Bold')
          .text(day.name, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(COLORS.darkGrey).font('Helvetica')
              .text(`  ${ex.name}`, 60);
            doc.fontSize(9).fill(COLORS.midGrey)
              .text(`    ${ex.sets} sets × ${ex.reps} reps${ex.rest ? ` · Rest: ${ex.rest}` : ''}${ex.notes ? ` · ${ex.notes}` : ''}`, 70);
          }
        }
        doc.moveDown(0.5);
      }
    } else if (workoutPlan) {
      doc.fontSize(10).fill(COLORS.darkGrey).font('Helvetica')
        .text(JSON.stringify(workoutPlan, null, 2), 50, undefined, { width: 495 });
    }

    // Page break for nutrition
    doc.addPage();

    // Nutrition header
    doc.rect(0, 0, 595.28, 50).fill(COLORS.black);
    doc.fontSize(18).fill(COLORS.gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 15, { characterSpacing: 2 });

    doc.moveDown(2);

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fill(COLORS.black).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50);
        if (nutritionPlan.protein) {
          doc.fontSize(10).fill(COLORS.midGrey).font('Helvetica')
            .text(`Protein: ${nutritionPlan.protein}g · Carbs: ${nutritionPlan.carbs || '—'}g · Fats: ${nutritionPlan.fats || '—'}g`, 50);
        }
        doc.moveDown(1);
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          doc.fontSize(12).fill(COLORS.gold).font('Helvetica-Bold')
            .text(meal.name, 50);
          doc.moveDown(0.3);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill(COLORS.darkGrey).font('Helvetica')
                .text(`  • ${opt}`, 60, undefined, { width: 485 });
            }
          }
          if (meal.description) {
            doc.fontSize(10).fill(COLORS.darkGrey).font('Helvetica')
              .text(`  ${meal.description}`, 60, undefined, { width: 485 });
          }
          doc.moveDown(0.5);
        }
      } else {
        doc.fontSize(10).fill(COLORS.darkGrey).font('Helvetica')
          .text(JSON.stringify(nutritionPlan, null, 2), 50, undefined, { width: 495 });
      }
    }

    // Notes section
    if (notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(COLORS.lightGrey);
      doc.moveDown(0.5);
      doc.fontSize(12).fill(COLORS.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, undefined, { characterSpacing: 2 });
      doc.moveDown(0.3);
      doc.fontSize(10).fill(COLORS.darkGrey).font('Helvetica')
        .text(notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(COLORS.lightGrey);
    doc.moveDown(0.5);
    doc.fontSize(8).fill(COLORS.midGrey).font('Helvetica')
      .text('fitnessbymaddy.com · This program is personalised — do not redistribute.', 50, undefined, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
