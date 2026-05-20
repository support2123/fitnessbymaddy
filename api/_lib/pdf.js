const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B'
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.black);
    doc.fontSize(28).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fillColor('#FFFFFF').text(`Week ${weekNo} Program`, 50, 55, { characterSpacing: 1 });

    // Client info
    doc.fillColor(BRAND.black);
    doc.moveDown(2);
    doc.y = 100;
    doc.fontSize(12).text(`Client: ${clientName}`, 50);
    doc.fontSize(10).fillColor(BRAND.grey).text(`Week ${weekNo} | Generated ${new Date().toLocaleDateString('en-IN')}`, 50);
    doc.moveDown(1.5);

    // Workout section
    doc.rect(50, doc.y, 495.28, 30).fill(BRAND.gold);
    doc.fontSize(14).fillColor('#FFFFFF').text('WORKOUT PLAN', 60, doc.y - 28 + 8, { characterSpacing: 2 });
    doc.y += 10;
    doc.fillColor(BRAND.black);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor(BRAND.gold).text(day.name || day.day, 50);
        doc.fontSize(9).fillColor(BRAND.black);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.text(`  ${ex.name} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`, 60);
          }
        }
        if (day.notes) {
          doc.fontSize(8).fillColor(BRAND.grey).text(`  Note: ${day.notes}`, 60);
        }
      }
    } else if (workoutPlan) {
      doc.moveDown(0.5);
      doc.fontSize(9).text(JSON.stringify(workoutPlan, null, 2), 60, doc.y, { width: 475 });
    }

    // Nutrition section
    doc.moveDown(2);
    if (doc.y > 650) doc.addPage();

    doc.rect(50, doc.y, 495.28, 30).fill(BRAND.gold);
    doc.fontSize(14).fillColor('#FFFFFF').text('NUTRITION PLAN', 60, doc.y - 28 + 8, { characterSpacing: 2 });
    doc.y += 10;
    doc.fillColor(BRAND.black);

    if (nutritionPlan && nutritionPlan.meals) {
      for (const meal of nutritionPlan.meals) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor(BRAND.gold).text(meal.name || meal.time, 50);
        doc.fontSize(9).fillColor(BRAND.black);
        if (meal.items) {
          for (const item of meal.items) {
            doc.text(`  ${item}`, 60);
          }
        }
        if (meal.notes) {
          doc.fontSize(8).fillColor(BRAND.grey).text(`  ${meal.notes}`, 60);
        }
      }
      if (nutritionPlan.macros) {
        doc.moveDown(1);
        doc.fontSize(10).fillColor(BRAND.gold).text('Daily Macros:', 50);
        doc.fontSize(9).fillColor(BRAND.black)
          .text(`Calories: ${nutritionPlan.macros.calories || 'TBD'} | Protein: ${nutritionPlan.macros.protein || 'TBD'}g | Carbs: ${nutritionPlan.macros.carbs || 'TBD'}g | Fat: ${nutritionPlan.macros.fat || 'TBD'}g`, 60);
      }
    } else if (nutritionPlan) {
      doc.moveDown(0.5);
      doc.fontSize(9).text(JSON.stringify(nutritionPlan, null, 2), 60, doc.y, { width: 475 });
    }

    // Notes
    if (notes) {
      doc.moveDown(2);
      if (doc.y > 700) doc.addPage();
      doc.fontSize(10).fillColor(BRAND.gold).text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor(BRAND.grey).text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const addFooter = () => {
      doc.fontSize(7).fillColor(BRAND.grey)
        .text('fitnessbymaddy.com | Confidential — for client use only', 50, 780, { align: 'center', width: 495 });
    };
    addFooter();

    doc.end();
  });
}

module.exports = { generateProgramPDF };
