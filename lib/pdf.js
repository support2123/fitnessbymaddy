const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  white: '#FFFFFF',
  grey: '#6B6B6B',
};

function generateProgramPDF(clientName, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 120).fill(BRAND.black);
    doc.fontSize(32).fill(BRAND.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill(BRAND.cream).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fontSize(11).fill(BRAND.goldLight)
      .text(clientName.toUpperCase(), 50, 95, { align: 'center' });

    doc.y = 140;

    // Workout section
    doc.rect(40, doc.y, 515, 30).fill(BRAND.gold);
    doc.fontSize(14).fill(BRAND.white).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, doc.y + 8);
    doc.y += 40;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (doc.y > 700) { doc.addPage(); doc.y = 50; }

        doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
          .text(day.name.toUpperCase(), 50, doc.y);
        doc.y += 18;

        if (day.focus) {
          doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
            .text(day.focus, 50, doc.y);
          doc.y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (doc.y > 740) { doc.addPage(); doc.y = 50; }
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(`• ${ex.name}`, 60, doc.y);
            doc.fontSize(9).fill(BRAND.grey)
              .text(`${ex.sets} × ${ex.reps} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 260, doc.y);
            doc.y += 16;
          }
        }
        doc.y += 10;
      }
    }

    // Nutrition section
    if (doc.y > 600) { doc.addPage(); doc.y = 50; }
    doc.rect(40, doc.y, 515, 30).fill(BRAND.gold);
    doc.fontSize(14).fill(BRAND.white).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, doc.y + 8);
    doc.y += 40;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.calories} kcal`, 50, doc.y);
        doc.y += 18;
      }

      if (nutrition.macros) {
        const m = nutrition.macros;
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${m.protein}g  |  Carbs: ${m.carbs}g  |  Fats: ${m.fats}g`, 50, doc.y);
        doc.y += 20;
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (doc.y > 740) { doc.addPage(); doc.y = 50; }
          doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
            .text(meal.name, 50, doc.y);
          doc.y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
                .text(`• ${item}`, 60, doc.y);
              doc.y += 14;
            }
          }
          doc.y += 8;
        }
      }
    }

    // Notes
    if (notes) {
      if (doc.y > 680) { doc.addPage(); doc.y = 50; }
      doc.y += 10;
      doc.rect(40, doc.y, 515, 2).fill(BRAND.goldLight);
      doc.y += 12;
      doc.fontSize(10).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, doc.y);
      doc.y += 16;
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, doc.y, { width: 495, lineGap: 4 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, 800, 595.28, 42).fill(BRAND.black);
      doc.fontSize(8).fill(BRAND.goldLight).font('Helvetica')
        .text('fitnessbymaddy.com  •  @fitnessbymaddy_', 50, 812, {
          align: 'center', width: 495,
        });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
