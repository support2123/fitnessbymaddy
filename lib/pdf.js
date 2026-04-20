const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#999999',
  cream: '#FAF8F4'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 100).fill(BRAND.black);
    doc.font('Helvetica-Bold').fontSize(28).fillColor(BRAND.gold)
      .text('FITNESS BY MADDY', 50, 30);
    doc.font('Helvetica').fontSize(11).fillColor(BRAND.goldLight)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65);

    // Client info bar
    doc.rect(0, 100, 595.28, 40).fill(BRAND.gold);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.black)
      .text(`CLIENT: ${(client.name || 'Client').toUpperCase()}`, 50, 112);
    doc.text(`PROGRAM: ${(client.program || '').toUpperCase().replace(/_/g, ' ')}`, 300, 112);

    let y = 170;

    // Workout section
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND.black)
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.gold).lineWidth(2).stroke();
    y += 15;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 720) {
          doc.addPage();
          y = 50;
        }

        doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND.gold)
          .text(day.name || 'Day', 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) {
              doc.addPage();
              y = 50;
            }

            doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.black)
              .text(ex.name || '', 70, y, { width: 250 });
            doc.font('Helvetica').fontSize(10).fillColor(BRAND.grey)
              .text(`${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 330, y);
            y += 18;

            if (ex.notes) {
              doc.font('Helvetica').fontSize(9).fillColor(BRAND.grey)
                .text(ex.notes, 70, y, { width: 460 });
              y += 14;
            }
          }
        }
        y += 12;
      }
    }

    // Nutrition section
    if (y > 600) {
      doc.addPage();
      y = 50;
    }

    y += 20;
    doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND.black)
      .text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.gold).lineWidth(2).stroke();
    y += 15;

    if (nutrition) {
      if (nutrition.calories) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND.black)
          .text(`Daily Target: ${nutrition.calories} kcal`, 50, y);
        y += 20;
      }
      if (nutrition.macros) {
        doc.font('Helvetica').fontSize(10).fillColor(BRAND.grey)
          .text(`Protein: ${nutrition.macros.protein || '—'}g | Carbs: ${nutrition.macros.carbs || '—'}g | Fats: ${nutrition.macros.fats || '—'}g`, 50, y);
        y += 25;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) {
            doc.addPage();
            y = 50;
          }
          doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND.gold)
            .text(meal.name || 'Meal', 50, y);
          y += 16;
          doc.font('Helvetica').fontSize(10).fillColor(BRAND.black)
            .text(meal.items || meal.description || '', 70, y, { width: 460 });
          y += 18;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 680) {
        doc.addPage();
        y = 50;
      }
      y += 20;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND.black)
        .text('COACH NOTES', 50, y);
      y += 20;
      doc.font('Helvetica').fontSize(10).fillColor(BRAND.grey)
        .text(notes, 50, y, { width: 495 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor(BRAND.grey)
        .text('fitnessbymaddy.com | Confidential — prepared exclusively for client use', 50, 800, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
