const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(28).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fillColor('#ffffff').text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.fillColor(BRAND.black);
    doc.moveDown(3);
    doc.fontSize(11).fillColor(BRAND.grey).text(`Prepared for: ${clientName}`, 50);
    doc.fontSize(11).text(`Week ${weekNo} of 12`, 50);
    doc.moveDown(1);

    // Divider
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(BRAND.gold).lineWidth(1).stroke();
    doc.moveDown(1);

    // Workout Plan
    doc.fontSize(18).fillColor(BRAND.black).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (workoutPlan && typeof workoutPlan === 'object') {
      const days = Object.keys(workoutPlan);
      for (const day of days) {
        doc.fontSize(13).fillColor(BRAND.gold).text(day.toUpperCase(), 50);
        doc.moveDown(0.3);
        const exercises = workoutPlan[day];
        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            const line = typeof ex === 'string' ? ex : `${ex.name} — ${ex.sets}x${ex.reps}${ex.rest ? ` (Rest: ${ex.rest})` : ''}`;
            doc.fontSize(10).fillColor(BRAND.grey).text(`  ${line}`, 60);
          }
        } else if (typeof exercises === 'string') {
          doc.fontSize(10).fillColor(BRAND.grey).text(`  ${exercises}`, 60);
        }
        doc.moveDown(0.5);

        if (doc.y > 700) {
          doc.addPage();
        }
      }
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(BRAND.gold).lineWidth(0.5).stroke();
    doc.moveDown(1);

    // Nutrition Plan
    doc.fontSize(18).fillColor(BRAND.black).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fillColor(BRAND.black).text(`Daily Calories: ${nutritionPlan.calories} kcal`, 50);
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fontSize(10).fillColor(BRAND.grey).text(`Protein: ${m.protein}g | Carbs: ${m.carbs}g | Fat: ${m.fat}g`, 50);
      }
      doc.moveDown(0.5);

      const meals = nutritionPlan.meals || Object.entries(nutritionPlan).filter(([k]) => !['calories', 'macros'].includes(k));
      if (Array.isArray(meals)) {
        for (const meal of meals) {
          if (Array.isArray(meal)) {
            doc.fontSize(12).fillColor(BRAND.gold).text(meal[0].toUpperCase(), 50);
            doc.fontSize(10).fillColor(BRAND.grey).text(`  ${typeof meal[1] === 'string' ? meal[1] : JSON.stringify(meal[1])}`, 60);
          } else if (typeof meal === 'object' && meal.name) {
            doc.fontSize(12).fillColor(BRAND.gold).text(meal.name.toUpperCase(), 50);
            if (meal.items) {
              for (const item of meal.items) {
                doc.fontSize(10).fillColor(BRAND.grey).text(`  ${item}`, 60);
              }
            }
          }
          doc.moveDown(0.3);
          if (doc.y > 700) doc.addPage();
        }
      }
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(BRAND.gold).lineWidth(0.5).stroke();
      doc.moveDown(1);
      doc.fontSize(14).fillColor(BRAND.black).text('COACH NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor(BRAND.grey).text(notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor(BRAND.grey).text('This program is personalised and confidential. Not for redistribution.', 50, undefined, { align: 'center', width: 495 });
    doc.fontSize(8).text('fitnessbymaddy.com | @fitnessbymaddy_', 50, undefined, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
