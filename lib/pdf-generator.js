const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#2C2C2C',
  gold: '#B8965A',
  grey: '#6B6B6B',
  cream: '#FAF8F4',
  white: '#FFFFFF',
};

function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill(COLORS.black);
    doc.fontSize(10).fillColor(COLORS.gold).text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fontSize(28).fillColor(COLORS.white).text(`Week ${weekNo} Program`, 50, 55);
    doc.fontSize(12).fillColor(COLORS.gold).text(clientName || 'Client', 50, 92);

    let y = 150;

    doc.fontSize(16).fillColor(COLORS.gold).text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fillColor(COLORS.black).text(day.name || 'Day', 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '(' + ex.rest + ' rest)' : ''}`;
            doc.fontSize(10).fillColor(COLORS.grey).text(line, 70, y);
            y += 16;
          }
        }

        if (day.notes) {
          doc.fontSize(9).fillColor(COLORS.gold).text(day.notes, 70, y);
          y += 16;
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fontSize(16).fillColor(COLORS.gold).text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fillColor(COLORS.black).text(
          `Daily Target: ${nutritionPlan.calories} kcal  |  P: ${nutritionPlan.protein || '—'}g  |  C: ${nutritionPlan.carbs || '—'}g  |  F: ${nutritionPlan.fats || '—'}g`,
          50, y
        );
        y += 24;
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(12).fillColor(COLORS.black).text(meal.name || 'Meal', 50, y);
          y += 18;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fillColor(COLORS.grey).text(`• ${item}`, 70, y);
              y += 14;
            }
          }
          y += 8;
        }
      }
    }

    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(16).fillColor(COLORS.gold).text('COACH NOTES', 50, y);
      y += 24;
      doc.fontSize(10).fillColor(COLORS.grey).text(notes, 50, y, { width: 495 });
    }

    const pageCount = doc.bufferedPageRange().count;
    doc.fontSize(8).fillColor(COLORS.grey)
      .text('© Fitness by Maddy — For personal use only', 50, 780, { width: 495, align: 'center' });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
