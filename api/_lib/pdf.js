const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#2C2C2C',
  gold: '#B8965A',
  grey: '#6B6B6B',
  cream: '#FAF8F4',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(COLORS.black);
    doc.fontSize(28).fillColor(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fillColor(COLORS.white)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.fillColor(COLORS.black);
    doc.moveDown(2);
    doc.y = 100;
    doc.fontSize(11).fillColor(COLORS.grey)
      .text(`Client: ${client.name}`, 50);
    doc.text(`Program: ${client.program}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    // Divider
    doc.moveTo(50, doc.y + 10).lineTo(545, doc.y + 10)
      .strokeColor(COLORS.gold).lineWidth(1).stroke();

    // Workout Plan
    doc.y += 25;
    doc.fontSize(18).fillColor(COLORS.gold)
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fillColor(COLORS.black)
          .text(day.name, 50, doc.y, { underline: true });
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `  ${ex.name} — ${ex.sets}x${ex.reps}`;
            const detail = ex.rest ? ` (Rest: ${ex.rest})` : '';
            doc.fontSize(10).fillColor(COLORS.grey)
              .text(line + detail, 60);
          }
        }
        if (day.notes) {
          doc.fontSize(9).fillColor(COLORS.gold)
            .text(`  Note: ${day.notes}`, 60);
        }
        doc.moveDown(0.5);

        if (doc.y > 700) doc.addPage();
      }
    } else if (typeof workout === 'string') {
      doc.fontSize(10).fillColor(COLORS.grey).text(workout, 50);
    }

    // Nutrition Plan
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y)
      .strokeColor(COLORS.gold).lineWidth(0.5).stroke();
    doc.y += 15;

    doc.fontSize(18).fillColor(COLORS.gold)
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fillColor(COLORS.black)
          .text(`Daily Target: ${nutrition.calories} kcal`, 50);
      }
      if (nutrition.macros) {
        doc.fontSize(10).fillColor(COLORS.grey)
          .text(`Protein: ${nutrition.macros.protein}g | Carbs: ${nutrition.macros.carbs}g | Fat: ${nutrition.macros.fat}g`, 50);
      }
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(12).fillColor(COLORS.black)
            .text(meal.name, 50);
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fillColor(COLORS.grey)
                .text(`  - ${item}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.notes) {
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor(COLORS.gold)
          .text(`Note: ${nutrition.notes}`, 50);
      }
    }

    // Coach notes
    if (notes) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y)
        .strokeColor(COLORS.gold).lineWidth(0.5).stroke();
      doc.y += 15;
      doc.fontSize(14).fillColor(COLORS.gold)
        .text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor(COLORS.grey)
        .text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const footerY = 780;
    doc.moveTo(50, footerY).lineTo(545, footerY)
      .strokeColor(COLORS.gold).lineWidth(0.5).stroke();
    doc.fontSize(8).fillColor(COLORS.grey)
      .text('Fitness by Maddy | fitnessbymaddy.com | This program is for personal use only.',
        50, footerY + 8, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
