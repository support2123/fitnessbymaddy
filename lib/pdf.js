const PDFDocument = require('pdfkit');

const CHARCOAL = '#2C2C2C';
const GOLD = '#B8965A';
const WHITE = '#FFFFFF';
const LIGHT = '#F0EAE0';

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 100).fill(CHARCOAL);
    doc.fontSize(28).fill(GOLD).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 3 });
    doc.fontSize(12).fill(WHITE).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65, { characterSpacing: 2 });

    // Client info
    doc.fill(CHARCOAL).fontSize(11).font('Helvetica')
      .text(`Client: ${client.name || 'N/A'}`, 50, 120)
      .text(`Program: ${client.program || 'Custom'}`, 50, 136)
      .text(`Week: ${weekNo}`, 350, 120)
      .text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 350, 136);

    doc.moveTo(50, 160).lineTo(545, 160).stroke(GOLD);

    let y = 180;

    // Workout plan
    if (workoutPlan) {
      doc.fontSize(18).fill(CHARCOAL).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50, y);
      y += 30;

      const days = Array.isArray(workoutPlan) ? workoutPlan : workoutPlan.days || [];
      for (const day of days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 24).fill(GOLD);
        doc.fontSize(11).fill(WHITE).font('Helvetica-Bold')
          .text((day.day || day.name || '').toUpperCase(), 60, y + 6);
        y += 30;

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(CHARCOAL).font('Helvetica-Bold')
            .text(ex.name || ex.exercise || '', 60, y);
          doc.font('Helvetica').fill('#6B6B6B')
            .text(`${ex.sets || ''} x ${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 60, y + 13);
          if (ex.notes) {
            doc.fontSize(9).fill('#999')
              .text(ex.notes, 60, y + 26);
            y += 40;
          } else {
            y += 30;
          }
        }
        y += 10;
      }
    }

    // Nutrition plan
    if (nutritionPlan) {
      if (y > 500) { doc.addPage(); y = 50; }
      doc.fontSize(18).fill(CHARCOAL).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50, y);
      y += 30;

      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(CHARCOAL).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 60, y);
        y += 16;
        if (nutritionPlan.protein) {
          doc.fontSize(10).fill('#6B6B6B').font('Helvetica')
            .text(`Protein: ${nutritionPlan.protein}g | Carbs: ${nutritionPlan.carbs || '—'}g | Fats: ${nutritionPlan.fats || '—'}g`, 60, y);
          y += 20;
        }
      }

      const meals = nutritionPlan.meals || [];
      for (const meal of meals) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.rect(50, y, 495, 22).fill(LIGHT);
        doc.fontSize(10).fill(CHARCOAL).font('Helvetica-Bold')
          .text((meal.name || meal.meal || '').toUpperCase(), 60, y + 5);
        y += 28;
        const items = meal.items || meal.foods || [];
        for (const item of items) {
          if (y > 740) { doc.addPage(); y = 50; }
          const label = typeof item === 'string' ? item : `${item.food || item.name} — ${item.portion || item.qty || ''}`;
          doc.fontSize(10).fill('#6B6B6B').font('Helvetica')
            .text(`• ${label}`, 70, y);
          y += 15;
        }
        y += 8;
      }
    }

    // Notes
    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.moveTo(50, y).lineTo(545, y).stroke(GOLD);
      y += 15;
      doc.fontSize(12).fill(CHARCOAL).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill('#6B6B6B').font('Helvetica')
        .text(notes, 60, y, { width: 475 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#999').font('Helvetica')
        .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
