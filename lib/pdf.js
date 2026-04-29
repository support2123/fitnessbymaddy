const PDFDocument = require('pdfkit');

const BRAND = {
  charcoal: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client name
    doc.moveDown(2);
    doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
      .text(`Prepared for: ${clientName}`, 50, 100);
    doc.fontSize(10).fill(BRAND.midGrey)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 115);

    // Divider
    doc.moveTo(50, 140).lineTo(545, 140).strokeColor(BRAND.lightGrey).stroke();

    let y = 160;

    // Workout Plan
    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 24).fill(BRAND.gold);
        doc.fontSize(11).fill('#FFFFFF').font('Helvetica-Bold')
          .text(day.name.toUpperCase(), 60, y + 6);
        y += 32;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
              .text(ex.name, 60, y);
            doc.fontSize(9).fill(BRAND.midGrey).font('Helvetica')
              .text(`${ex.sets} sets x ${ex.reps} reps  |  Rest: ${ex.rest || '60s'}`, 60, y + 14);
            if (ex.notes) {
              doc.fontSize(8).fill(BRAND.gold)
                .text(ex.notes, 60, y + 26);
              y += 40;
            } else {
              y += 30;
            }
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.lightGrey).stroke();
    y += 20;

    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 60, y);
        y += 20;
      }
      if (nutritionPlan.macros) {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
          .text(`Protein: ${nutritionPlan.macros.protein}g  |  Carbs: ${nutritionPlan.macros.carbs}g  |  Fat: ${nutritionPlan.macros.fat}g`, 60, y);
        y += 24;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.charcoal).font('Helvetica-Bold')
            .text(meal.name, 60, y);
          y += 16;
          doc.fontSize(9).fill(BRAND.midGrey).font('Helvetica')
            .text(meal.description, 60, y, { width: 470 });
          y += doc.heightOfString(meal.description, { width: 470 }) + 10;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 660) { doc.addPage(); y = 50; }
      y += 10;
      doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.lightGrey).stroke();
      y += 20;
      doc.fontSize(14).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 22;
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(notes, 60, y, { width: 470 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.midGrey).font('Helvetica')
        .text('fitnessbymaddy.com  |  Confidential — prepared exclusively for client use', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
