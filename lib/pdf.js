const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#FFFFFF')
      .text(client.name.toUpperCase(), 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fill(BRAND.gold).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(BRAND.black).text(day.name, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.grey)
              .text(`  ${ex.name}  —  ${ex.sets}x${ex.reps}  ${ex.notes || ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 60).fill(BRAND.black);
    doc.fontSize(18).fill(BRAND.gold).text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(12).fill(BRAND.black)
          .text(`Daily Target: ${nutrition.calories} kcal`, 50);
        doc.fontSize(10).fill(BRAND.grey)
          .text(`Protein: ${nutrition.protein}g  |  Carbs: ${nutrition.carbs}g  |  Fat: ${nutrition.fat}g`, 50);
        doc.moveDown(1);
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(12).fill(BRAND.black).text(meal.name, 50);
          doc.fontSize(10).fill(BRAND.grey).text(meal.description, 60);
          doc.moveDown(0.5);
        }
      }
    }

    if (notes) {
      doc.moveDown(1);
      doc.fontSize(14).fill(BRAND.gold).text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, doc.y, { width: 495 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill(BRAND.grey)
      .text('This program is personalised for you. Do not share or redistribute.', 50, doc.page.height - 60, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
