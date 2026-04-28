const PDFDocument = require('pdfkit');

const GOLD = '#B8965A';
const CHARCOAL = '#2C2C2C';
const MID_GREY = '#6B6B6B';

function generateProgramPDF(clientName, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(12).fill(GOLD).text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#AAAAAA').text(`Prepared for ${clientName}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fill(GOLD).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(GOLD);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(CHARCOAL).text(day.name, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(MID_GREY)
              .text(`  ${ex.name}  -  ${ex.sets} x ${ex.reps}${ex.rest ? '  (Rest: ' + ex.rest + ')' : ''}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    } else if (typeof workout === 'string') {
      doc.fontSize(10).fill(MID_GREY).text(workout, 60);
    }

    doc.moveDown(1);

    doc.fontSize(18).fill(GOLD).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(GOLD);
    doc.moveDown(0.5);

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill(CHARCOAL).text(meal.name, 50);
        doc.fontSize(10).fill(MID_GREY).text(`  ${meal.description}`, 60);
        if (meal.macros) {
          doc.fontSize(9).fill(MID_GREY).text(`  Macros: ${meal.macros}`, 60);
        }
        doc.moveDown(0.3);
      }
    } else if (typeof nutrition === 'string') {
      doc.fontSize(10).fill(MID_GREY).text(nutrition, 60);
    }

    if (notes) {
      doc.moveDown(1);
      doc.fontSize(14).fill(GOLD).text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fill(MID_GREY).text(notes, 60, undefined, { width: 480 });
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#CCCCCC')
      .text('This program is personalised for you. Do not share or redistribute.', 50, undefined, { align: 'center' });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
