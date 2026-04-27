const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  charcoal: '#2C2C2C',
  midGrey: '#6B6B6B',
  cream: '#FAF8F4',
};

function generateProgramPdf(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.charcoal);
    doc.fontSize(28).fillColor('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });
    doc.fontSize(12).fillColor(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 3 });

    doc.moveDown(3);
    doc.fontSize(14).fillColor(BRAND.charcoal)
      .text(`Client: ${clientName}`, 50);
    doc.fontSize(10).fillColor(BRAND.midGrey)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);
    doc.moveDown(1.5);

    doc.rect(50, doc.y, doc.page.width - 100, 2).fill(BRAND.gold);
    doc.moveDown(1);

    doc.fontSize(16).fillColor(BRAND.charcoal)
      .text('WORKOUT PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(12).fillColor(BRAND.gold)
          .text(day.name || day.day, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor(BRAND.charcoal)
              .text(`  ${ex.name}`, 60);
            doc.fontSize(9).fillColor(BRAND.midGrey)
              .text(`    ${ex.sets} sets x ${ex.reps} reps${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, 70);
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).fillColor(BRAND.midGrey)
        .text(JSON.stringify(workoutPlan, null, 2), 60);
    }

    if (doc.y > doc.page.height - 300) doc.addPage();

    doc.moveDown(1);
    doc.rect(50, doc.y, doc.page.width - 100, 2).fill(BRAND.gold);
    doc.moveDown(1);

    doc.fontSize(16).fillColor(BRAND.charcoal)
      .text('NUTRITION PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (nutritionPlan && nutritionPlan.meals) {
      if (nutritionPlan.dailyCalories) {
        doc.fontSize(10).fillColor(BRAND.gold)
          .text(`Daily Target: ${nutritionPlan.dailyCalories} kcal | P: ${nutritionPlan.protein}g | C: ${nutritionPlan.carbs}g | F: ${nutritionPlan.fats}g`, 60);
        doc.moveDown(0.5);
      }
      for (const meal of nutritionPlan.meals) {
        doc.fontSize(11).fillColor(BRAND.charcoal)
          .text(meal.name || meal.time, 60);
        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(9).fillColor(BRAND.midGrey)
              .text(`  - ${item}`, 70);
          }
        }
        if (meal.calories) {
          doc.fontSize(8).fillColor(BRAND.midGrey)
            .text(`    ~${meal.calories} kcal`, 70);
        }
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(10).fillColor(BRAND.midGrey)
        .text(JSON.stringify(nutritionPlan, null, 2), 60);
    }

    if (notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, doc.page.width - 100, 2).fill(BRAND.gold);
      doc.moveDown(1);
      doc.fontSize(16).fillColor(BRAND.charcoal)
        .text('COACH NOTES', 50, doc.y, { characterSpacing: 2 });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(BRAND.midGrey)
        .text(notes, 60, doc.y, { width: doc.page.width - 120 });
    }

    const footerY = doc.page.height - 40;
    doc.fontSize(8).fillColor(BRAND.midGrey)
      .text('Fitness by Maddy | fitnessbymaddy.com | Confidential - For client use only', 50, footerY, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}

module.exports = { generateProgramPdf };
