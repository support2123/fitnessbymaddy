const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  charcoal: '#2C2C2C',
  grey: '#6B6B6B',
  cream: '#FAF8F4'
};

function generateProgramPdf(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.charcoal);
    doc.fontSize(28).fillColor('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 4 });
    doc.fontSize(10).fillColor(BRAND.goldLight)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(3);
    doc.fontSize(11).fillColor(BRAND.grey)
      .text(`Client: ${client.name || 'N/A'}`, 50);
    doc.text(`Program: ${client.program || 'Custom'}`, 50);
    doc.text(`Week: ${weekNo}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    // Gold divider
    doc.moveDown(1);
    doc.rect(50, doc.y, 495.28, 2).fill(BRAND.gold);
    doc.moveDown(1);

    // Workout Plan
    doc.fontSize(18).fillColor(BRAND.charcoal)
      .text('WORKOUT PLAN', 50, doc.y + 10, { characterSpacing: 3 });
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 40, 2).fill(BRAND.gold);
    doc.moveDown(1);

    if (workoutPlan && typeof workoutPlan === 'object') {
      const days = Array.isArray(workoutPlan) ? workoutPlan : Object.entries(workoutPlan);
      for (const entry of days) {
        const [day, exercises] = Array.isArray(entry) ? entry : [entry.day, entry.exercises];
        doc.fontSize(13).fillColor(BRAND.gold)
          .text(String(day).toUpperCase(), 50);
        doc.moveDown(0.3);

        const exList = Array.isArray(exercises) ? exercises : [exercises];
        for (const ex of exList) {
          if (typeof ex === 'string') {
            doc.fontSize(10).fillColor(BRAND.charcoal).text(`  ${ex}`, 60);
          } else if (ex && typeof ex === 'object') {
            const line = `${ex.name || ex.exercise || ''} - ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fontSize(10).fillColor(BRAND.charcoal).text(`  ${line.trim()}`, 60);
          }
        }
        doc.moveDown(0.5);

        if (doc.y > 700) {
          doc.addPage();
        }
      }
    } else {
      doc.fontSize(10).fillColor(BRAND.grey).text('Workout plan details will be provided separately.', 50);
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, 595.28, 4).fill(BRAND.gold);

    doc.fontSize(18).fillColor(BRAND.charcoal)
      .text('NUTRITION PLAN', 50, 40, { characterSpacing: 3 });
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 40, 2).fill(BRAND.gold);
    doc.moveDown(1);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fillColor(BRAND.charcoal)
          .text(`Daily Calories: ${nutritionPlan.calories} kcal`, 50);
      }
      if (nutritionPlan.protein) {
        doc.text(`Protein: ${nutritionPlan.protein}g | Carbs: ${nutritionPlan.carbs || '-'}g | Fat: ${nutritionPlan.fat || '-'}g`, 50);
      }
      doc.moveDown(1);

      const meals = nutritionPlan.meals || nutritionPlan;
      const mealEntries = Array.isArray(meals) ? meals : Object.entries(meals).filter(([k]) => !['calories', 'protein', 'carbs', 'fat'].includes(k));

      for (const entry of mealEntries) {
        const [mealName, mealDetail] = Array.isArray(entry) && !entry.meal ? entry : [entry.meal || entry[0], entry.items || entry.detail || entry[1]];
        doc.fontSize(12).fillColor(BRAND.gold).text(String(mealName).toUpperCase(), 50);
        doc.moveDown(0.3);

        if (Array.isArray(mealDetail)) {
          for (const item of mealDetail) {
            doc.fontSize(10).fillColor(BRAND.charcoal).text(`  ${typeof item === 'string' ? item : JSON.stringify(item)}`, 60);
          }
        } else if (typeof mealDetail === 'string') {
          doc.fontSize(10).fillColor(BRAND.charcoal).text(`  ${mealDetail}`, 60);
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).fillColor(BRAND.grey).text('Nutrition plan details will be provided separately.', 50);
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.rect(50, doc.y, 495.28, 2).fill(BRAND.gold);
      doc.moveDown(1);
      doc.fontSize(12).fillColor(BRAND.charcoal)
        .text('COACH NOTES', 50, doc.y, { characterSpacing: 2 });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(BRAND.grey).text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fillColor(BRAND.grey)
      .text('Fitness by Maddy | fitnessbymaddy.com | This plan is confidential and for personal use only.', 50, 780, { align: 'center', width: 495 });

    doc.end();
  });
}

module.exports = { generateProgramPdf };
