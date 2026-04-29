const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
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
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(24).fill('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(10).fill(BRAND.grey)
      .text(`Prepared for: ${clientName}`, 50, 100);
    doc.text(`Week: ${weekNo}`, 50, 115);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 130);

    // Divider
    doc.moveTo(50, 150).lineTo(545, 150).stroke(BRAND.gold);

    // Workout Plan
    let y = 170;
    doc.fontSize(18).fill(BRAND.black)
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill(BRAND.gold)
          .text(day.name.toUpperCase(), 50, y, { characterSpacing: 1 });
        y += 20;

        if (day.focus) {
          doc.fontSize(9).fill(BRAND.grey).text(`Focus: ${day.focus}`, 50, y);
          y += 15;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.black)
              .text(`${ex.name}`, 70, y);
            doc.fontSize(9).fill(BRAND.grey)
              .text(`${ex.sets} x ${ex.reps} ${ex.notes || ''}`, 300, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 620) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.lightGrey);
    y += 20;

    doc.fontSize(18).fill(BRAND.black)
      .text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.black)
          .text(`Daily Calories: ${nutritionPlan.calories} kcal`, 50, y);
        y += 18;
      }
      if (nutritionPlan.macros) {
        doc.fontSize(10).fill(BRAND.grey)
          .text(`Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`, 50, y);
        y += 25;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold)
            .text(meal.name, 50, y);
          y += 16;
          doc.fontSize(9).fill(BRAND.grey)
            .text(meal.description, 70, y, { width: 460 });
          y += doc.heightOfString(meal.description, { width: 460 }) + 8;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 10;
      doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.lightGrey);
      y += 20;
      doc.fontSize(12).fill(BRAND.black).text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey)
        .text('fitnessbymaddy.com | Confidential', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
