const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1A1A1A',
  gold: '#B8965A',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  white: '#FFFFFF',
};

function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(COLORS.black);
    doc.fontSize(28).fill(COLORS.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(COLORS.white).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.fill(COLORS.black).fontSize(12).font('Helvetica')
      .text(`Client: ${clientName}`, 50, 100);
    doc.fontSize(10).fill(COLORS.grey)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 118);

    // Divider
    doc.moveTo(50, 140).lineTo(545, 140).strokeColor(COLORS.gold).lineWidth(1.5).stroke();

    let y = 160;

    // Workout section
    doc.fontSize(18).fill(COLORS.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 24).fill(COLORS.black);
        doc.fontSize(10).fill(COLORS.gold).font('Helvetica-Bold')
          .text(day.name.toUpperCase(), 60, y + 7, { characterSpacing: 1 });
        y += 30;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(COLORS.black).font('Helvetica-Bold')
              .text(ex.name, 60, y);
            doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
              .text(`${ex.sets} sets x ${ex.reps} reps${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, 60, y + 14);
            if (ex.notes) {
              doc.fontSize(8).fill(COLORS.gold)
                .text(ex.notes, 60, y + 28);
              y += 42;
            } else {
              y += 32;
            }
          }
        }
        y += 10;
      }
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.gold).lineWidth(1).stroke();
    y += 20;

    doc.fontSize(18).fill(COLORS.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.rect(50, y, 160, 50).fill(COLORS.black);
        doc.fontSize(20).fill(COLORS.gold).font('Helvetica-Bold')
          .text(String(nutritionPlan.calories), 60, y + 8);
        doc.fontSize(8).fill(COLORS.white).font('Helvetica')
          .text('DAILY CALORIES', 60, y + 32);

        if (nutritionPlan.protein) {
          doc.rect(220, y, 105, 50).fill(COLORS.black);
          doc.fontSize(16).fill(COLORS.gold).font('Helvetica-Bold')
            .text(`${nutritionPlan.protein}g`, 230, y + 10);
          doc.fontSize(8).fill(COLORS.white).font('Helvetica')
            .text('PROTEIN', 230, y + 32);
        }
        if (nutritionPlan.carbs) {
          doc.rect(335, y, 105, 50).fill(COLORS.black);
          doc.fontSize(16).fill(COLORS.gold).font('Helvetica-Bold')
            .text(`${nutritionPlan.carbs}g`, 345, y + 10);
          doc.fontSize(8).fill(COLORS.white).font('Helvetica')
            .text('CARBS', 345, y + 32);
        }
        if (nutritionPlan.fat) {
          doc.rect(450, y, 95, 50).fill(COLORS.black);
          doc.fontSize(16).fill(COLORS.gold).font('Helvetica-Bold')
            .text(`${nutritionPlan.fat}g`, 460, y + 10);
          doc.fontSize(8).fill(COLORS.white).font('Helvetica')
            .text('FAT', 460, y + 32);
        }
        y += 65;
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(COLORS.black).font('Helvetica-Bold')
            .text(meal.name, 60, y);
          doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
            .text(meal.description, 60, y + 16, { width: 470 });
          y += 40;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.lightGrey).lineWidth(0.5).stroke();
      y += 15;
      doc.fontSize(10).fill(COLORS.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 18;
      doc.fontSize(9).fill(COLORS.grey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(COLORS.grey).font('Helvetica')
        .text('fitnessbymaddy.com | Confidential — For client use only',
          50, 780, { width: 495, align: 'center' });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
