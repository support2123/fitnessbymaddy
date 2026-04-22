const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  white: '#FFFFFF',
  midGrey: '#6B6B6B',
};

function generateProgramPdf(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);

    // Header bar
    doc.rect(0, 0, doc.page.width, 90).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25);
    doc.fontSize(12).fill(BRAND.white).font('Helvetica')
      .text(`${client.name} — Week ${weekNo}`, 50, 58);

    let y = 110;

    // Workout section
    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name, 50, y);
        y += 20;
        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `${ex.name}  —  ${ex.sets}×${ex.reps}${ex.rest ? '  rest ' + ex.rest : ''}`;
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(line, 65, y);
            y += 16;
          }
        }
        y += 8;
        if (y > 700) { doc.addPage(); y = 50; }
      }
    }

    // Nutrition section
    y += 10;
    if (y > 650) { doc.addPage(); y = 50; }
    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.midGrey).font('Helvetica')
          .text(`Daily Target: ${nutrition.calories} kcal  |  P: ${nutrition.protein}g  |  C: ${nutrition.carbs}g  |  F: ${nutrition.fats}g`, 50, y);
        y += 25;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50, y);
          y += 18;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.black).font('Helvetica')
                .text(`• ${item}`, 65, y);
              y += 15;
            }
          }
          y += 6;
          if (y > 700) { doc.addPage(); y = 50; }
        }
      }
    }

    // Notes
    if (notes) {
      y += 15;
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fontSize(14).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 22;
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer
    const lastPage = doc.bufferedPageRange();
    doc.fontSize(8).fill(BRAND.midGrey).font('Helvetica')
      .text('fitnessbymaddy.com  |  Confidential — for personal use only', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPdf };
