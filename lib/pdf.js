const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);
    doc.fillColor(BRAND.gold)
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fillColor(BRAND.white)
      .fontSize(14)
      .font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72, { characterSpacing: 2 });
    doc.fillColor(BRAND.goldLight)
      .fontSize(11)
      .text(`Prepared for ${clientName}`, 50, 95);

    doc.rect(50, 130, doc.page.width - 100, 2).fill(BRAND.gold);

    let y = 150;

    doc.fillColor(BRAND.gold)
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black); y = 50; }

        doc.fillColor(BRAND.goldLight)
          .fontSize(13)
          .font('Helvetica-Bold')
          .text(day.name || day.day, 50, y);
        y += 20;

        if (day.focus) {
          doc.fillColor(BRAND.grey)
            .fontSize(9)
            .font('Helvetica')
            .text(`Focus: ${day.focus}`, 50, y);
          y += 16;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black); y = 50; }
            doc.fillColor(BRAND.white)
              .fontSize(10)
              .font('Helvetica')
              .text(`• ${ex.name}`, 65, y);
            doc.fillColor(BRAND.goldLight)
              .fontSize(9)
              .text(`  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 65, y + 13);
            y += 30;
          }
        }

        if (day.rest) {
          doc.fillColor(BRAND.grey)
            .fontSize(10)
            .font('Helvetica')
            .text('Rest Day — active recovery encouraged', 65, y);
          y += 20;
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black); y = 50; }

    y += 10;
    doc.rect(50, y, doc.page.width - 100, 2).fill(BRAND.gold);
    y += 20;

    doc.fillColor(BRAND.gold)
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fillColor(BRAND.white).fontSize(11).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50, y);
        y += 18;
      }
      if (nutritionPlan.macros) {
        doc.fillColor(BRAND.goldLight).fontSize(10).font('Helvetica')
          .text(`Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`, 50, y);
        y += 24;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 700) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black); y = 50; }
          doc.fillColor(BRAND.goldLight)
            .fontSize(11)
            .font('Helvetica-Bold')
            .text(meal.name, 50, y);
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fillColor(BRAND.white).fontSize(10).font('Helvetica')
                .text(`• ${item}`, 65, y);
              y += 15;
            }
          }
          y += 8;
        }
      }
      if (nutritionPlan.notes) {
        y += 10;
        doc.fillColor(BRAND.grey).fontSize(9).font('Helvetica')
          .text(`Note: ${nutritionPlan.notes}`, 50, y, { width: doc.page.width - 100 });
        y += 30;
      }
    }

    if (notes) {
      if (y > 680) { doc.addPage(); doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black); y = 50; }
      y += 10;
      doc.rect(50, y, doc.page.width - 100, 2).fill(BRAND.gold);
      y += 20;
      doc.fillColor(BRAND.gold).fontSize(16).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y, { characterSpacing: 2 });
      y += 25;
      doc.fillColor(BRAND.white).fontSize(10).font('Helvetica')
        .text(notes, 50, y, { width: doc.page.width - 100 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor(BRAND.grey).fontSize(8).font('Helvetica')
        .text('fitnessbymaddy.com', 50, doc.page.height - 30)
        .text(`Page ${i + 1} of ${pageCount}`, doc.page.width - 120, doc.page.height - 30);
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
