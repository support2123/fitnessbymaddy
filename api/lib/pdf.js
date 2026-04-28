const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text(`Client: ${client.name || 'N/A'}`, 50);
    doc.text(`Program: ${formatProgram(client.program)}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);
    doc.moveDown(1.5);

    // Workout section
    doc.rect(50, doc.y, 495.28, 30).fill(BRAND.black);
    doc.fontSize(14).fill('#FFFFFF').font('Helvetica-Bold')
      .text('WORKOUT PLAN', 60, doc.y - 28 + 8, { characterSpacing: 2 });
    doc.moveDown(1);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(`  ${ex.name}`, 50, doc.y, { continued: true })
              .fill(BRAND.grey)
              .text(`  —  ${ex.sets} x ${ex.reps}${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, { continued: false });
          }
        }

        if (day.notes) {
          doc.fontSize(9).fill(BRAND.grey).font('Helvetica-Oblique')
            .text(`  Note: ${day.notes}`, 50);
        }
        doc.moveDown(0.8);

        if (doc.y > 700) {
          doc.addPage();
        }
      }
    }

    // Nutrition section
    doc.moveDown(0.5);
    if (doc.y > 650) doc.addPage();

    doc.rect(50, doc.y, 495.28, 30).fill(BRAND.black);
    doc.fontSize(14).fill('#FFFFFF').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 60, doc.y - 28 + 8, { characterSpacing: 2 });
    doc.moveDown(1);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.calories} kcal`, 50);
        if (nutrition.macros) {
          doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
            .text(`Protein: ${nutrition.macros.protein}g | Carbs: ${nutrition.macros.carbs}g | Fats: ${nutrition.macros.fats}g`, 50);
        }
        doc.moveDown(0.8);
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50);
          doc.fontSize(10).fill(BRAND.black).font('Helvetica')
            .text(meal.description || '', 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill(BRAND.grey)
                .text(`  • ${opt}`, 60);
            }
          }
          doc.moveDown(0.5);
        }
      }
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      if (doc.y > 700) doc.addPage();
      doc.rect(50, doc.y, 495.28, 30).fill(BRAND.gold);
      doc.fontSize(14).fill('#FFFFFF').font('Helvetica-Bold')
        .text('COACH NOTES', 60, doc.y - 28 + 8, { characterSpacing: 2 });
      doc.moveDown(1);
      doc.fontSize(10).fill(BRAND.black).font('Helvetica')
        .text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
      .text('© Fitness by Maddy — fitnessbymaddy.com', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    pcos: 'PCOS Warrior',
    '40plus': '40+ Strong',
    zoom_trial: 'Zoom Trial',
    zoom_pack: 'Zoom Pack',
  };
  return map[code] || code;
}

module.exports = { generateProgramPDF };
