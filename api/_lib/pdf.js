const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPdf(client, weekNo, workoutPlan, nutritionPlan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Cover page ---
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
    doc.fontSize(14).fillColor(BRAND.gold)
      .text('FITNESS BY MADDY', 50, 200, { align: 'center', characterSpacing: 6 });
    doc.moveDown(1);
    doc.fontSize(36).fillColor(BRAND.white)
      .text(`WEEK ${weekNo}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(18).fillColor(BRAND.gold)
      .text('CUSTOM PROGRAM', { align: 'center', characterSpacing: 4 });
    doc.moveDown(2);
    doc.fontSize(12).fillColor(BRAND.grey)
      .text(`Prepared for: ${client.name || 'Client'}`, { align: 'center' });
    doc.text(`Program: ${formatProgram(client.program)}`, { align: 'center' });

    // --- Workout Plan ---
    doc.addPage();
    sectionHeader(doc, 'WORKOUT PLAN');
    doc.moveDown(1);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(13).fillColor(BRAND.gold)
          .text(day.name || day.day, { underline: true });
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor(BRAND.black)
              .text(`  ${ex.name}  —  ${ex.sets || '?'} x ${ex.reps || '?'}${ex.rest ? '  (rest: ' + ex.rest + ')' : ''}`, { lineGap: 2 });
          }
        }
        if (day.notes) {
          doc.fontSize(9).fillColor(BRAND.grey).text(`  Note: ${day.notes}`);
        }
        doc.moveDown(0.8);

        if (doc.y > 700) doc.addPage();
      }
    }

    // --- Nutrition Plan ---
    doc.addPage();
    sectionHeader(doc, 'NUTRITION PLAN');
    doc.moveDown(1);

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fillColor(BRAND.black)
          .text(`Daily Calories: ${nutritionPlan.calories} kcal`);
      }
      if (nutritionPlan.macros) {
        doc.text(`Macros: P ${nutritionPlan.macros.protein}g | C ${nutritionPlan.macros.carbs}g | F ${nutritionPlan.macros.fat}g`);
      }
      doc.moveDown(1);

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          doc.fontSize(12).fillColor(BRAND.gold).text(meal.name || 'Meal');
          doc.fontSize(10).fillColor(BRAND.black);
          if (meal.items) {
            for (const item of meal.items) {
              doc.text(`  - ${item}`, { lineGap: 2 });
            }
          }
          if (meal.notes) {
            doc.fontSize(9).fillColor(BRAND.grey).text(`  ${meal.notes}`);
          }
          doc.moveDown(0.6);
        }
      }

      if (nutritionPlan.notes) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor(BRAND.grey).text(nutritionPlan.notes);
      }
    }

    // --- Footer on every page ---
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor(BRAND.grey)
        .text('fitnessbymaddy.com | Confidential — prepared exclusively for you',
          50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });
    }

    doc.end();
  });
}

function sectionHeader(doc, title) {
  doc.fontSize(8).fillColor(BRAND.gold)
    .text('FITNESS BY MADDY', { characterSpacing: 4 });
  doc.moveDown(0.3);
  doc.fontSize(24).fillColor(BRAND.black).text(title);
  doc.moveTo(50, doc.y + 4).lineTo(200, doc.y + 4).strokeColor(BRAND.gold).stroke();
}

function formatProgram(p) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[p] || p;
}

module.exports = { generateProgramPdf };
