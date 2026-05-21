const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
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

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(BRAND.gold).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 72);
    doc.fontSize(11).fill('#CCCCCC')
      .text(`Prepared for ${clientName}`, 50, 92);

    let y = 145;

    doc.rect(50, y, doc.page.width - 100, 1).fill(BRAND.gold);
    y += 20;

    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || day.day, 50, y);
        y += 20;

        if (day.focus) {
          doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
            .text(`Focus: ${day.focus}`, 60, y);
          y += 16;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(line, 70, y, { width: 450 });
            y += 16;

            if (ex.notes) {
              doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
                .text(ex.notes, 80, y, { width: 430 });
              y += 14;
            }
          }
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); y = 50; }
    y += 10;
    doc.rect(50, y, doc.page.width - 100, 1).fill(BRAND.gold);
    y += 20;

    doc.fontSize(18).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Calories: ${nutritionPlan.calories} kcal`, 60, y);
        y += 18;
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${m.protein || '-'}g  |  Carbs: ${m.carbs || '-'}g  |  Fat: ${m.fat || '-'}g`, 60, y);
        y += 20;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name || meal.time, 60, y);
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.black).font('Helvetica')
                .text(`- ${item}`, 70, y, { width: 440 });
              y += 14;
            }
          }
          if (meal.description) {
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(meal.description, 70, y, { width: 440 });
            y += 14;
          }
          y += 8;
        }
      }
    }

    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 10;
      doc.rect(50, y, doc.page.width - 100, 1).fill(BRAND.lightGrey);
      y += 20;
      doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
        .text("COACH'S NOTES", 50, y);
      y += 20;
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 60, y, { width: 460 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey)
        .text(
          `Fitness by Maddy | Week ${weekNo} | Page ${i + 1}`,
          50, doc.page.height - 30,
          { width: doc.page.width - 100, align: 'center' }
        );
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
