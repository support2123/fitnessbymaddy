const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  white: '#FFFFFF',
  grey: '#6B6B6B',
  cream: '#FAF8F4'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 100).fill(BRAND.black);
    doc.fontSize(28).font('Helvetica-Bold').fillColor(BRAND.gold)
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).font('Helvetica').fillColor(BRAND.white)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65);

    // Client info
    doc.fillColor(BRAND.black);
    doc.moveDown(3);
    doc.fontSize(11).font('Helvetica')
      .text(`Client: ${client.name || 'N/A'}`, 50)
      .text(`Program: ${formatProgram(client.program)}`, 50)
      .text(`Week: ${weekNo}`, 50);

    doc.moveDown(1);
    doc.rect(50, doc.y, 495, 2).fill(BRAND.gold);
    doc.moveDown(1);

    // Workout Plan
    doc.fontSize(18).font('Helvetica-Bold').fillColor(BRAND.black)
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).font('Helvetica-Bold').fillColor(BRAND.gold)
          .text(day.name, 50);
        doc.fontSize(10).font('Helvetica').fillColor(BRAND.grey)
          .text(day.focus || '', 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fillColor(BRAND.black)
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}${ex.rest ? ` (rest: ${ex.rest})` : ''}`, 50);
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).font('Helvetica').fillColor(BRAND.grey)
        .text(JSON.stringify(workout, null, 2), 50);
    }

    // Nutrition Plan
    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);
    doc.rect(50, doc.y, 495, 2).fill(BRAND.gold);
    doc.moveDown(1);
    doc.fontSize(18).font('Helvetica-Bold').fillColor(BRAND.black)
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND.black)
          .text(`Daily Target: ${nutrition.calories} kcal`, 50);
      }
      if (nutrition.macros) {
        doc.fontSize(10).font('Helvetica').fillColor(BRAND.grey)
          .text(`Protein: ${nutrition.macros.protein}g | Carbs: ${nutrition.macros.carbs}g | Fat: ${nutrition.macros.fat}g`, 50);
      }
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND.gold)
            .text(meal.name, 50);
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).font('Helvetica').fillColor(BRAND.black)
                .text(`  • ${item}`, 50);
            }
          }
          doc.moveDown(0.3);
        }
      }
    }

    // Notes
    if (notes) {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(1);
      doc.rect(50, doc.y, 495, 2).fill(BRAND.gold);
      doc.moveDown(1);
      doc.fontSize(14).font('Helvetica-Bold').fillColor(BRAND.black)
        .text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor(BRAND.grey)
        .text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font('Helvetica').fillColor(BRAND.grey)
        .text('Fitness by Maddy | fitnessbymaddy.com | Confidential', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code || 'Custom';
}

module.exports = { generateProgramPDF, formatProgram };
