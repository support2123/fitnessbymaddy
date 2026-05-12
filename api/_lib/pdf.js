const PDFDocument = require('pdfkit');

const GOLD = '#B8965A';
const CHARCOAL = '#2C2C2C';
const MID_GREY = '#6B6B6B';
const LIGHT_GREY = '#E8E3DC';

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(CHARCOAL);
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).font('Helvetica').fillColor(GOLD)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.fillColor(MID_GREY).fontSize(10).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`, 400, 30);
    doc.text(`Program: ${client.program || '12wk'}`, 400, 45);
    doc.text(`Week: ${weekNo}`, 400, 60);

    let y = 100;

    // Workout section
    doc.fillColor(CHARCOAL).fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
    y += 8;
    doc.moveTo(50, y + 20).lineTo(545, y + 20).strokeColor(GOLD).lineWidth(2).stroke();
    y += 35;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 24).fill(LIGHT_GREY);
        doc.fillColor(CHARCOAL).fontSize(11).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 58, y + 6);
        y += 32;

        if (day.exercises) {
          // Table header
          doc.fillColor(MID_GREY).fontSize(8).font('Helvetica-Bold');
          doc.text('EXERCISE', 58, y);
          doc.text('SETS', 300, y);
          doc.text('REPS', 360, y);
          doc.text('REST', 420, y);
          doc.text('NOTES', 470, y);
          y += 16;

          doc.font('Helvetica').fontSize(9).fillColor(CHARCOAL);
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.text(ex.name || '', 58, y, { width: 230 });
            doc.text(String(ex.sets || ''), 300, y);
            doc.text(String(ex.reps || ''), 360, y);
            doc.text(String(ex.rest || ''), 420, y);
            doc.text(String(ex.notes || ''), 470, y, { width: 75 });
            y += 18;
          }
        }
        y += 10;
      }
    }

    // Nutrition section
    doc.addPage();
    y = 50;
    doc.fillColor(CHARCOAL).fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
    y += 8;
    doc.moveTo(50, y + 20).lineTo(545, y + 20).strokeColor(GOLD).lineWidth(2).stroke();
    y += 35;

    if (nutritionPlan) {
      // Macro summary
      doc.rect(50, y, 495, 60).fill(CHARCOAL);
      doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold');
      doc.text(`CALORIES: ${nutritionPlan.calories || '—'}`, 70, y + 10);
      doc.text(`PROTEIN: ${nutritionPlan.protein || '—'}g`, 200, y + 10);
      doc.text(`CARBS: ${nutritionPlan.carbs || '—'}g`, 330, y + 10);
      doc.text(`FAT: ${nutritionPlan.fat || '—'}g`, 460, y + 10);
      if (nutritionPlan.hydration) {
        doc.fillColor(GOLD).fontSize(9).font('Helvetica')
          .text(`Hydration: ${nutritionPlan.hydration}`, 70, y + 35);
      }
      y += 75;

      // Meals
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
            .text(`${meal.time || ''} — ${meal.name || ''}`, 50, y);
          y += 16;
          doc.fillColor(CHARCOAL).fontSize(9).font('Helvetica')
            .text(meal.description || '', 50, y, { width: 495 });
          y += doc.heightOfString(meal.description || '', { width: 495 }) + 8;

          if (meal.macros) {
            doc.fillColor(MID_GREY).fontSize(8)
              .text(`P: ${meal.macros.protein || 0}g  |  C: ${meal.macros.carbs || 0}g  |  F: ${meal.macros.fat || 0}g`, 50, y);
            y += 18;
          }
          y += 6;
        }
      }

      // Supplements
      if (nutritionPlan.supplements && nutritionPlan.supplements.length > 0) {
        y += 10;
        doc.fillColor(CHARCOAL).fontSize(11).font('Helvetica-Bold')
          .text('SUPPLEMENTS', 50, y);
        y += 18;
        doc.fontSize(9).font('Helvetica').fillColor(MID_GREY);
        for (const supp of nutritionPlan.supplements) {
          doc.text(`• ${supp}`, 58, y);
          y += 14;
        }
      }
    }

    // Notes
    if (notes) {
      y += 20;
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fillColor(CHARCOAL).fontSize(11).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 18;
      doc.fontSize(9).font('Helvetica').fillColor(MID_GREY)
        .text(notes, 50, y, { width: 495 });
    }

    // Footer on last page
    const pageBottom = 780;
    doc.fillColor(MID_GREY).fontSize(7).font('Helvetica')
      .text('Fitness by Maddy | fitnessbymaddy.com | This program is personalised — do not share.', 50, pageBottom, { align: 'center' });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
