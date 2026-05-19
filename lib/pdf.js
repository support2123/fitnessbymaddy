const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(COLORS.black);
    doc.fontSize(28).fillColor(COLORS.gold).text('FITNESS BY MADDY', 50, 25);
    doc.fontSize(10).fillColor('#999').text(`Week ${weekNo} Program`, 50, 55);

    // Client info
    doc.fillColor(COLORS.black);
    doc.moveDown(3);
    doc.fontSize(14).text(`${clientName} — Week ${weekNo}`, 50, 100);
    doc.fontSize(9).fillColor(COLORS.grey).text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 120);

    // Workout section
    doc.moveDown(2);
    doc.fontSize(18).fillColor(COLORS.gold).text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(COLORS.lightGrey).stroke();
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(12).fillColor(COLORS.black).text(day.name || day.day, 50);
        doc.fontSize(9).fillColor(COLORS.grey);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.text(`  • ${ex.name} — ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? `(Rest: ${ex.rest})` : ''}`, 60);
          }
        }
        if (day.notes) {
          doc.fontSize(8).fillColor(COLORS.gold).text(`  Note: ${day.notes}`, 60);
        }
        doc.moveDown(0.5);
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fillColor(COLORS.grey).text(workoutPlan, 50, doc.y, { width: 495 });
    }

    // Nutrition section
    if (doc.y > 650) doc.addPage();
    doc.moveDown(1.5);
    doc.fontSize(18).fillColor(COLORS.gold).text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(COLORS.lightGrey).stroke();
    doc.moveDown(0.5);

    if (nutritionPlan && nutritionPlan.meals) {
      for (const meal of nutritionPlan.meals) {
        doc.fontSize(11).fillColor(COLORS.black).text(meal.name || meal.meal, 50);
        doc.fontSize(9).fillColor(COLORS.grey);
        if (meal.items) {
          for (const item of meal.items) {
            doc.text(`  • ${item}`, 60);
          }
        }
        if (meal.macros) {
          doc.fontSize(8).fillColor(COLORS.gold).text(`  Macros: ${meal.macros}`, 60);
        }
        doc.moveDown(0.3);
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fillColor(COLORS.grey).text(nutritionPlan, 50, doc.y, { width: 495 });
    }

    if (nutritionPlan && nutritionPlan.dailyTargets) {
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(COLORS.black).text('Daily Targets:', 50);
      doc.fontSize(9).fillColor(COLORS.grey).text(
        `Calories: ${nutritionPlan.dailyTargets.calories || 'TBD'} | Protein: ${nutritionPlan.dailyTargets.protein || 'TBD'}g | Water: ${nutritionPlan.dailyTargets.water || '3L'}`,
        60
      );
    }

    // Notes
    if (notes) {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(1.5);
      doc.fontSize(18).fillColor(COLORS.gold).text('COACH NOTES', 50);
      doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(COLORS.lightGrey).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(COLORS.grey).text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(COLORS.grey).text(
        'Fitness by Maddy | fitnessbymaddy.com | Confidential',
        50, 780, { align: 'center', width: 495 }
      );
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
