const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#CCCCCC',
  bodyFont: 'Helvetica',
  headerFont: 'Helvetica-Bold'
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 100).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).font(BRAND.headerFont)
      .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 3 });
    doc.fontSize(12).fill(BRAND.goldLight).font(BRAND.bodyFont)
      .text(`WEEK ${weekNo} PROGRAM — ${(clientName || 'CLIENT').toUpperCase()}`, 50, 68, { characterSpacing: 1 });

    // Gold divider
    doc.rect(50, 120, 495, 2).fill(BRAND.gold);

    let y = 145;

    // Workout section
    doc.fontSize(18).fill(BRAND.black).font(BRAND.headerFont)
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 26).fill('#F5F0E8');
        doc.fontSize(11).fill(BRAND.black).font(BRAND.headerFont)
          .text((day.name || day.day || '').toUpperCase(), 60, y + 7);
        y += 32;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#333').font(BRAND.bodyFont)
              .text(`• ${ex.name || ex}`, 70, y);
            if (ex.sets) {
              doc.fontSize(9).fill('#888')
                .text(`${ex.sets} sets × ${ex.reps} reps${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, 300, y);
            }
            y += 18;
          }
        }
        y += 10;
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fill('#333').font(BRAND.bodyFont)
        .text(workoutPlan, 60, y, { width: 475 });
      y += doc.heightOfString(workoutPlan, { width: 475 }) + 20;
    }

    if (y > 600) { doc.addPage(); y = 50; }

    // Nutrition section
    doc.rect(50, y, 495, 2).fill(BRAND.gold);
    y += 15;
    doc.fontSize(18).fill(BRAND.black).font(BRAND.headerFont)
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan && nutritionPlan.meals) {
      if (nutritionPlan.calories) {
        doc.fontSize(10).fill(BRAND.gold).font(BRAND.headerFont)
          .text(`Daily Target: ${nutritionPlan.calories} kcal | P: ${nutritionPlan.protein || '—'}g | C: ${nutritionPlan.carbs || '—'}g | F: ${nutritionPlan.fat || '—'}g`, 60, y);
        y += 24;
      }

      for (const meal of nutritionPlan.meals) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill(BRAND.black).font(BRAND.headerFont)
          .text((meal.name || meal.time || '').toUpperCase(), 60, y);
        y += 18;
        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(10).fill('#333').font(BRAND.bodyFont)
              .text(`• ${item}`, 70, y);
            y += 16;
          }
        }
        if (meal.description) {
          doc.fontSize(10).fill('#333').font(BRAND.bodyFont)
            .text(meal.description, 70, y, { width: 455 });
          y += doc.heightOfString(meal.description, { width: 455 }) + 8;
        }
        y += 8;
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fill('#333').font(BRAND.bodyFont)
        .text(nutritionPlan, 60, y, { width: 475 });
      y += doc.heightOfString(nutritionPlan, { width: 475 }) + 20;
    }

    // Notes
    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 2).fill(BRAND.gold);
      y += 15;
      doc.fontSize(14).fill(BRAND.black).font(BRAND.headerFont).text('NOTES', 50, y);
      y += 24;
      doc.fontSize(10).fill('#333').font(BRAND.bodyFont)
        .text(notes, 60, y, { width: 475 });
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#999').font(BRAND.bodyFont)
        .text('fitnessbymaddy.com | Confidential — prepared exclusively for you', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
