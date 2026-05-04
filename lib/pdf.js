const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  white: '#FFFFFF',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
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
    doc.fontSize(32).fill(BRAND.gold).text('FITNESS BY MADDY', 50, 30, { characterSpacing: 3 });
    doc.fontSize(11).fill(BRAND.white).text(`WEEK ${weekNo} PROGRAM`, 50, 70, { characterSpacing: 2 });

    // Client info bar
    doc.rect(0, 100, 595, 40).fill(BRAND.gold);
    doc.fontSize(10).fill(BRAND.black)
      .text(`${(client.name || 'Client').toUpperCase()}  |  ${client.program.toUpperCase().replace(/_/g, ' ')}`, 50, 114, { characterSpacing: 1 });

    let y = 170;

    // Workout section
    doc.fontSize(18).fill(BRAND.black).text('WORKOUT PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.gold);
    y += 15;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(12).fill(BRAND.gold).text(day.name.toUpperCase(), 50, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.black).text(`• ${ex.name}`, 60, y);
            doc.fill(BRAND.grey).text(`${ex.sets} x ${ex.reps} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 250, y);
            y += 16;
          }
        }

        if (day.notes) {
          doc.fontSize(9).fill(BRAND.grey).text(`Note: ${day.notes}`, 60, y);
          y += 14;
        }
        y += 10;
      }
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fontSize(18).fill(BRAND.black).text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.gold);
    y += 15;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.black).text(`Daily Target: ${nutrition.calories} kcal`, 50, y);
        y += 18;
      }
      if (nutrition.macros) {
        doc.fontSize(10).fill(BRAND.grey)
          .text(`Protein: ${nutrition.macros.protein}g  |  Carbs: ${nutrition.macros.carbs}g  |  Fat: ${nutrition.macros.fat}g`, 50, y);
        y += 22;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold).text(meal.name.toUpperCase(), 50, y);
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.black).text(`• ${item}`, 60, y);
              y += 14;
            }
          }
          y += 8;
        }
      }
    }

    // Notes section
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.fontSize(18).fill(BRAND.black).text('COACH NOTES', 50, y);
      y += 28;
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, y, { width: 495, lineGap: 4 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey)
        .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
