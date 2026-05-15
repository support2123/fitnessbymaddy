const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1a1a1a',
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

    // Header bar
    doc.rect(0, 0, 595.28, 120).fill(COLORS.black);
    doc.fontSize(10).fill(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fontSize(28).fill(COLORS.white)
      .text(`Week ${weekNo} Program`, 50, 55);
    doc.fontSize(12).fill(COLORS.goldLight)
      .text(clientName, 50, 92);

    let y = 145;

    // Workout Plan
    doc.fontSize(16).fill(COLORS.black)
      .text('WORKOUT PLAN', 50, y);
    y += 8;
    doc.rect(50, y, 80, 2).fill(COLORS.gold);
    y += 20;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(12).fill(COLORS.gold)
          .text(day.name || day.day, 50, y);
        y += 18;

        if (day.focus) {
          doc.fontSize(9).fill(COLORS.grey)
            .text(day.focus, 50, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fontSize(10).fill(COLORS.black)
              .text(line, 65, y, { width: 465 });
            y += 16;
          }
        }
        y += 10;
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fill(COLORS.black)
        .text(workoutPlan, 50, y, { width: 495 });
      y += doc.heightOfString(workoutPlan, { width: 495 }) + 20;
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    y += 10;
    doc.fontSize(16).fill(COLORS.black)
      .text('NUTRITION PLAN', 50, y);
    y += 8;
    doc.rect(50, y, 80, 2).fill(COLORS.gold);
    y += 20;

    if (nutritionPlan && nutritionPlan.meals) {
      for (const meal of nutritionPlan.meals) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(11).fill(COLORS.gold)
          .text(meal.name || meal.time, 50, y);
        y += 16;

        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(10).fill(COLORS.black)
              .text(`• ${item}`, 65, y, { width: 465 });
            y += 15;
          }
        }

        if (meal.macros) {
          doc.fontSize(9).fill(COLORS.grey)
            .text(meal.macros, 65, y);
          y += 14;
        }
        y += 8;
      }

      if (nutritionPlan.dailyTotals) {
        if (y > 720) { doc.addPage(); y = 50; }
        y += 5;
        doc.rect(50, y, 495, 1).fill(COLORS.goldLight);
        y += 10;
        doc.fontSize(10).fill(COLORS.black)
          .text(`Daily Totals: ${nutritionPlan.dailyTotals}`, 50, y);
        y += 20;
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fill(COLORS.black)
        .text(nutritionPlan, 50, y, { width: 495 });
      y += doc.heightOfString(nutritionPlan, { width: 495 }) + 20;
    }

    // Notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(12).fill(COLORS.black)
        .text('NOTES', 50, y);
      y += 6;
      doc.rect(50, y, 40, 2).fill(COLORS.gold);
      y += 15;
      doc.fontSize(10).fill(COLORS.grey)
        .text(notes, 50, y, { width: 495 });
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(COLORS.grey)
        .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 800, {
          width: 495, align: 'center'
        });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
