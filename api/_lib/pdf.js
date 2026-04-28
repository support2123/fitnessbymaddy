const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.goldLight).text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.grey).text(`Prepared for: ${clientName}`, 50);
    doc.fontSize(9).fill(BRAND.grey).text(`Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50);
    doc.moveDown(1.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(1);

    // Workout section
    doc.fontSize(18).fill(BRAND.black).text('WORKOUT PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.moveDown(0.5);
        doc.fontSize(12).fill(BRAND.gold).text(day.name || day.day, 50);
        doc.fontSize(9).fill(BRAND.grey).text(day.focus || '', 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.black).text(
              `  ${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest ? '| Rest: ' + ex.rest : ''}`,
              60
            );
            if (ex.notes) {
              doc.fontSize(8).fill(BRAND.grey).text(`    ${ex.notes}`, 70);
            }
          }
        }

        if (doc.y > 700) {
          doc.addPage();
        }
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fill(BRAND.black).text(workoutPlan, 50, doc.y, { width: 495 });
    }

    // Nutrition section
    doc.addPage();
    doc.rect(0, 0, 595.28, 5).fill(BRAND.gold);
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.black).text('NUTRITION PLAN', 50, 30, { characterSpacing: 2 });
    doc.moveDown(1);

    if (nutritionPlan && nutritionPlan.meals) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.gold).text(`Daily Target: ${nutritionPlan.calories} kcal`, 50);
        if (nutritionPlan.macros) {
          doc.fontSize(9).fill(BRAND.grey).text(
            `Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`,
            50
          );
        }
        doc.moveDown(1);
      }

      for (const meal of nutritionPlan.meals) {
        doc.fontSize(12).fill(BRAND.gold).text(meal.name, 50);
        doc.moveDown(0.3);
        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(10).fill(BRAND.black).text(`  ${item}`, 60);
          }
        }
        if (meal.notes) {
          doc.fontSize(8).fill(BRAND.grey).text(`  ${meal.notes}`, 60);
        }
        doc.moveDown(0.5);
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fill(BRAND.black).text(nutritionPlan, 50, doc.y, { width: 495 });
    }

    // Notes section
    if (notes) {
      doc.moveDown(1.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
      doc.moveDown(0.5);
      doc.fontSize(12).fill(BRAND.black).text('COACH NOTES', 50, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);
    doc.fontSize(8).fill(BRAND.grey).text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
