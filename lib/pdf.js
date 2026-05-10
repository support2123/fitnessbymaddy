const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  charcoal: '#2C2C2C',
  grey: '#6B6B6B',
  cream: '#FAF8F4'
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);

    doc.rect(0, 0, doc.page.width, 120).fill(BRAND.charcoal);
    doc.fillColor('#FFFFFF')
      .fontSize(28)
      .text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fillColor(BRAND.gold)
      .fontSize(14)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'left' });
    doc.fillColor(BRAND.goldLight)
      .fontSize(11)
      .text(`Prepared for ${clientName}`, 50, 94, { align: 'left' });

    let y = 145;

    doc.fillColor(BRAND.charcoal).fontSize(18).text('WORKOUT PLAN', 50, y);
    y += 30;
    doc.rect(50, y - 5, doc.page.width - 100, 2).fill(BRAND.gold);
    y += 10;

    if (workoutPlan && typeof workoutPlan === 'object') {
      const days = workoutPlan.days || workoutPlan;
      const dayEntries = Array.isArray(days) ? days : Object.entries(days);

      for (const entry of dayEntries) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
          y = 50;
        }

        const dayName = Array.isArray(entry) ? entry[0] : (entry.day || entry.name || '');
        const exercises = Array.isArray(entry) ? entry[1] : (entry.exercises || []);

        doc.fillColor(BRAND.gold).fontSize(13).text(String(dayName).toUpperCase(), 50, y);
        y += 20;

        const exList = Array.isArray(exercises) ? exercises : [exercises];
        for (const ex of exList) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
            y = 50;
          }
          const line = typeof ex === 'string' ? ex : `${ex.name || ex.exercise || ''} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`;
          doc.fillColor(BRAND.charcoal).fontSize(10).text(`  ${line.trim()}`, 60, y);
          y += 16;
        }
        y += 10;
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fillColor(BRAND.charcoal).fontSize(10).text(workoutPlan, 50, y, { width: doc.page.width - 100 });
      y += 100;
    }

    if (y > 600) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
      y = 50;
    }

    y += 20;
    doc.fillColor(BRAND.charcoal).fontSize(18).text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.rect(50, y - 5, doc.page.width - 100, 2).fill(BRAND.gold);
    y += 10;

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      if (nutritionPlan.calories) {
        doc.fillColor(BRAND.gold).fontSize(12).text(`Daily Calories: ${nutritionPlan.calories}`, 50, y);
        y += 20;
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fillColor(BRAND.charcoal).fontSize(10)
          .text(`Protein: ${m.protein || '-'}  |  Carbs: ${m.carbs || '-'}  |  Fat: ${m.fat || '-'}`, 50, y);
        y += 20;
      }
      const meals = nutritionPlan.meals || nutritionPlan.meal_plan || [];
      if (Array.isArray(meals)) {
        for (const meal of meals) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
            y = 50;
          }
          const mealName = typeof meal === 'string' ? meal : (meal.name || meal.meal || '');
          const mealItems = typeof meal === 'string' ? '' : (meal.items || meal.foods || []);
          doc.fillColor(BRAND.gold).fontSize(11).text(String(mealName).toUpperCase(), 50, y);
          y += 16;
          if (Array.isArray(mealItems)) {
            for (const item of mealItems) {
              doc.fillColor(BRAND.charcoal).fontSize(10).text(`  ${typeof item === 'string' ? item : item.name || ''}`, 60, y);
              y += 14;
            }
          }
          y += 8;
        }
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fillColor(BRAND.charcoal).fontSize(10).text(nutritionPlan, 50, y, { width: doc.page.width - 100 });
    }

    if (notes) {
      if (y > 680) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.cream);
        y = 50;
      }
      y += 20;
      doc.fillColor(BRAND.charcoal).fontSize(14).text('COACH NOTES', 50, y);
      y += 20;
      doc.fillColor(BRAND.grey).fontSize(10).text(notes, 50, y, { width: doc.page.width - 100 });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
