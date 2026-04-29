const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);
    doc.fillColor('#FFFFFF')
      .fontSize(28)
      .text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fillColor(BRAND.gold)
      .fontSize(14)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'left' });
    doc.fillColor('#FFFFFF')
      .fontSize(10)
      .text(client.name || 'Client', 50, 95, { align: 'left' });

    let y = 145;

    doc.fillColor(BRAND.gold).fontSize(10).text(
      `Generated: ${new Date().toLocaleDateString('en-IN')}`,
      50, y
    );
    y += 30;

    doc.fillColor(BRAND.black).fontSize(18).text('WORKOUT PLAN', 50, y);
    y += 25;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.gold).lineWidth(1).stroke();
    y += 15;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
          y = 50;
        }

        doc.fillColor(BRAND.gold).fontSize(12).text(day.name || 'Day', 50, y);
        y += 18;

        if (day.focus) {
          doc.fillColor(BRAND.grey).fontSize(9).text(day.focus, 50, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
              y = 50;
            }
            const line = `${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fillColor(BRAND.black).fontSize(10).text(line, 70, y);
            y += 16;

            if (ex.notes) {
              doc.fillColor(BRAND.grey).fontSize(8).text(ex.notes, 85, y);
              y += 14;
            }
          }
        }
        y += 10;
      }
    } else if (workoutPlan && workoutPlan.summary) {
      doc.fillColor(BRAND.black).fontSize(10).text(workoutPlan.summary, 50, y, { width: 495 });
      y += doc.heightOfString(workoutPlan.summary, { width: 495 }) + 15;
    }

    if (y > 600) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
      y = 50;
    }

    y += 10;
    doc.fillColor(BRAND.black).fontSize(18).text('NUTRITION PLAN', 50, y);
    y += 25;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.gold).lineWidth(1).stroke();
    y += 15;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fillColor(BRAND.black).fontSize(11).text(
          `Daily Target: ${nutritionPlan.calories} kcal`, 50, y
        );
        y += 18;
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fillColor(BRAND.grey).fontSize(10).text(
          `Protein: ${m.protein || '—'}g  |  Carbs: ${m.carbs || '—'}g  |  Fat: ${m.fat || '—'}g`,
          50, y
        );
        y += 20;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 700) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
            y = 50;
          }
          doc.fillColor(BRAND.gold).fontSize(11).text(meal.name || 'Meal', 50, y);
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fillColor(BRAND.black).fontSize(10).text(`• ${item}`, 70, y);
              y += 14;
            }
          }
          if (meal.notes) {
            doc.fillColor(BRAND.grey).fontSize(8).text(meal.notes, 70, y);
            y += 14;
          }
          y += 8;
        }
      }
      if (nutritionPlan.notes) {
        y += 5;
        doc.fillColor(BRAND.grey).fontSize(9).text(nutritionPlan.notes, 50, y, { width: 495 });
        y += doc.heightOfString(nutritionPlan.notes, { width: 495 }) + 10;
      }
    }

    if (notes) {
      if (y > 650) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
        y = 50;
      }
      y += 10;
      doc.fillColor(BRAND.black).fontSize(14).text('COACH NOTES', 50, y);
      y += 20;
      doc.fillColor(BRAND.grey).fontSize(10).text(notes, 50, y, { width: 495 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fillColor(BRAND.grey).fontSize(8).text(
        `Fitness by Maddy | Week ${weekNo} | Page ${i + 1}/${pageCount}`,
        50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 }
      );
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
