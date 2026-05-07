const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  charcoal: '#2C2C2C',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(3);
    doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`, 50)
      .text(`Program: ${formatProgramName(client.program)}`)
      .text(`Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}`);

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.lightGrey);

    // Workout plan
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || day.day, 50);
        doc.fontSize(9).fill(BRAND.grey).font('Helvetica');

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.text(`  ${ex.name} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`, 60);
          }
        }
        if (day.notes) {
          doc.fontSize(8).fill(BRAND.grey).text(`  Note: ${day.notes}`, 60);
        }
        doc.moveDown(0.5);
      }
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.lightGrey);

    // Nutrition plan
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.calories} kcal`, 50);
      }
      if (nutrition.macros) {
        doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${nutrition.macros.protein}g | Carbs: ${nutrition.macros.carbs}g | Fat: ${nutrition.macros.fat}g`, 50);
      }
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50);
          doc.fontSize(9).fill(BRAND.grey).font('Helvetica');
          if (meal.items) {
            for (const item of meal.items) {
              doc.text(`  • ${item}`, 60);
            }
          }
          if (meal.notes) {
            doc.fontSize(8).text(`  ${meal.notes}`, 60);
          }
          doc.moveDown(0.3);
        }
      }
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.lightGrey);
      doc.moveDown(1);
      doc.fontSize(14).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('NOTES FROM MADDY', 50);
      doc.moveDown(0.5);
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, undefined, { width: 495 });
    }

    // Footer
    const footerY = doc.page.height - 50;
    doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, footerY, { align: 'center', width: 495 });

    doc.end();
  });
}

function formatProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[code] || code;
}

module.exports = { generateProgramPDF, formatProgramName };
