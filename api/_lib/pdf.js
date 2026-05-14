const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1a1a1a',
  gold: '#B8965A',
  charcoal: '#2C2C2C',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  cream: '#FAF8F4',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(COLORS.charcoal);
    doc.fontSize(28).fill(COLORS.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(COLORS.white).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info bar
    doc.rect(0, 80, 595.28, 40).fill(COLORS.gold);
    doc.fontSize(10).fill(COLORS.white).font('Helvetica-Bold')
      .text(`${(client.name || 'Client').toUpperCase()}  |  ${client.program.replace(/_/g, ' ').toUpperCase()}`, 50, 92, { characterSpacing: 1 });

    let y = 140;

    // Workout Plan
    doc.fontSize(16).fill(COLORS.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
    y += 5;
    doc.moveTo(50, y + 20).lineTo(545, y + 20).stroke(COLORS.gold);
    y += 35;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(12).fill(COLORS.gold).font('Helvetica-Bold')
          .text(day.name.toUpperCase(), 50, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) {
              doc.addPage();
              y = 50;
            }
            doc.fontSize(10).fill(COLORS.charcoal).font('Helvetica-Bold')
              .text(ex.name, 70, y);
            doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
              .text(`${ex.sets} sets × ${ex.reps} reps${ex.rest ? ` | Rest: ${ex.rest}` : ''}${ex.notes ? ` | ${ex.notes}` : ''}`, 70, y + 13);
            y += 30;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) {
      doc.addPage();
      y = 50;
    }

    y += 10;
    doc.fontSize(16).fill(COLORS.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
    y += 5;
    doc.moveTo(50, y + 20).lineTo(545, y + 20).stroke(COLORS.gold);
    y += 35;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(COLORS.charcoal).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50, y);
        y += 16;
        doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
          .text(`Protein: ${nutritionPlan.protein || '—'}g  |  Carbs: ${nutritionPlan.carbs || '—'}g  |  Fats: ${nutritionPlan.fats || '—'}g`, 50, y);
        y += 25;
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) {
            doc.addPage();
            y = 50;
          }
          doc.fontSize(11).fill(COLORS.gold).font('Helvetica-Bold')
            .text(meal.name.toUpperCase(), 50, y);
          y += 16;
          doc.fontSize(9).fill(COLORS.charcoal).font('Helvetica')
            .text(meal.description || meal.items?.join(', ') || '', 70, y, { width: 460 });
          y += doc.heightOfString(meal.description || meal.items?.join(', ') || '', { width: 460 }) + 10;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 650) {
        doc.addPage();
        y = 50;
      }
      y += 15;
      doc.fontSize(16).fill(COLORS.charcoal).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y, { characterSpacing: 2 });
      y += 5;
      doc.moveTo(50, y + 20).lineTo(545, y + 20).stroke(COLORS.gold);
      y += 35;
      doc.fontSize(10).fill(COLORS.grey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(COLORS.grey).font('Helvetica')
        .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
