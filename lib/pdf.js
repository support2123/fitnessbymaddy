const PDFDocument = require('pdfkit');

const BRAND = {
  charcoal: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function generateProgramPDF(clientName, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill(BRAND.charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65);

    doc.moveDown(3);
    doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
      .text(`Prepared for: ${clientName}`, 50);
    doc.text(`Week: ${weekNo}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);
    doc.moveDown(2);

    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}${ex.rest ? `  (Rest: ${ex.rest})` : ''}`, { indent: 10 });
          }
        }
        doc.moveDown(0.5);
      }
    } else if (typeof workout === 'string') {
      doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica').text(workout);
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(2);
    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(meal.name);
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
          .text(meal.description || '', { indent: 10 });
        if (meal.macros) {
          doc.fontSize(9).fill(BRAND.midGrey)
            .text(`  Protein: ${meal.macros.protein}g | Carbs: ${meal.macros.carbs}g | Fat: ${meal.macros.fat}g`, { indent: 10 });
        }
        doc.moveDown(0.3);
      }
    } else if (typeof nutrition === 'string') {
      doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica').text(nutrition);
    }

    if (notes) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(2);
      doc.fontSize(14).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('COACH NOTES');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
      doc.moveDown(0.5);
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica').text(notes);
    }

    doc.moveDown(3);
    doc.fontSize(8).fill(BRAND.midGrey).font('Helvetica')
      .text('This program is personalized for you. Do not share or redistribute.', { align: 'center' });
    doc.text('fitnessbymaddy.com | @fitnessbymaddy_', { align: 'center' });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
