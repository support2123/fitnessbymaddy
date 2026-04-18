const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill(COLORS.black);

    doc
      .fontSize(10)
      .fillColor(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 3 });

    doc
      .fontSize(28)
      .fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program`, 50, 55);

    doc
      .fontSize(12)
      .fillColor(COLORS.gold)
      .text(clientName.toUpperCase(), 50, 92, { characterSpacing: 2 });

    let y = 145;

    // Workout section
    doc
      .fontSize(16)
      .fillColor(COLORS.gold)
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.lightGrey).stroke();
    y += 15;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc
          .fontSize(13)
          .fillColor(COLORS.black)
          .text(day.name || day.day, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fontSize(10).fillColor(COLORS.grey).text(line, 70, y);
            y += 16;
          }
        }

        if (day.notes) {
          doc.fontSize(9).fillColor(COLORS.gold).text(`Note: ${day.notes}`, 70, y);
          y += 14;
        }

        y += 10;

        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      }
    }

    y += 10;
    if (y > 600) {
      doc.addPage();
      y = 50;
    }

    // Nutrition section
    doc
      .fontSize(16)
      .fillColor(COLORS.gold)
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.lightGrey).stroke();
    y += 15;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc
          .fontSize(11)
          .fillColor(COLORS.black)
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50, y);
        y += 18;
      }

      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc
          .fontSize(10)
          .fillColor(COLORS.grey)
          .text(`Protein: ${m.protein}g  |  Carbs: ${m.carbs}g  |  Fats: ${m.fats}g`, 50, y);
        y += 20;
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          doc
            .fontSize(12)
            .fillColor(COLORS.black)
            .text(meal.name || meal.time, 50, y);
          y += 16;

          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fillColor(COLORS.grey).text(`• ${item}`, 70, y);
              y += 14;
            }
          }
          y += 8;

          if (y > 700) {
            doc.addPage();
            y = 50;
          }
        }
      }
    }

    // Notes
    if (notes) {
      y += 15;
      if (y > 680) {
        doc.addPage();
        y = 50;
      }

      doc
        .fontSize(16)
        .fillColor(COLORS.gold)
        .text('COACH NOTES', 50, y);
      y += 25;

      doc
        .fontSize(10)
        .fillColor(COLORS.grey)
        .text(notes, 50, y, { width: 495 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor(COLORS.gold)
        .text('fitnessbymaddy.com | Confidential — prepared exclusively for you', 50, 780, {
          width: 495,
          align: 'center',
        });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
