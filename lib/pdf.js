const PDFDocument = require('pdfkit');
const { getClient } = require('./supabase');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

function generateProgramPDF({ clientName, weekNo, workoutPlan, nutritionPlan, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(BRAND.black);
    doc.fontSize(24).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 28, { characterSpacing: 3 });

    // Week badge
    doc.rect(50, 100, 160, 32).fill(BRAND.gold);
    doc.fontSize(11).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 58, 109, { characterSpacing: 2 });

    // Client name
    doc.fontSize(14).fill(BRAND.black).text(`Prepared for: ${clientName}`, 50, 150);
    doc.fontSize(10).fill(BRAND.grey).text(
      `Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      50, 170
    );

    doc.moveTo(50, 195).lineTo(doc.page.width - 50, 195).stroke(BRAND.lightGrey);

    let y = 215;

    // Workout Plan
    if (workoutPlan) {
      doc.fontSize(16).fill(BRAND.gold).text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
      y += 30;

      const days = Array.isArray(workoutPlan) ? workoutPlan : workoutPlan.days || [];
      for (const day of days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, doc.page.width - 100, 24).fill(BRAND.black);
        doc.fontSize(10).fill('#FFFFFF').text(
          (day.day || day.name || '').toUpperCase(), 60, y + 7, { characterSpacing: 1 }
        );
        y += 32;

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          if (y > 730) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(BRAND.black).text(
            `• ${ex.name || ex}`, 60, y
          );
          if (ex.sets) {
            doc.fontSize(9).fill(BRAND.grey).text(
              `  ${ex.sets} sets × ${ex.reps || ex.duration}${ex.rest ? ' | Rest: ' + ex.rest : ''}`,
              70, y + 14
            );
            y += 30;
          } else {
            y += 18;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (nutritionPlan) {
      if (y > 550) { doc.addPage(); y = 50; }

      doc.fontSize(16).fill(BRAND.gold).text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
      y += 30;

      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.black).text(`Daily Calories: ${nutritionPlan.calories} kcal`, 60, y);
        y += 18;
      }
      if (nutritionPlan.protein) {
        doc.fontSize(10).fill(BRAND.grey).text(
          `Protein: ${nutritionPlan.protein}g | Carbs: ${nutritionPlan.carbs || '—'}g | Fat: ${nutritionPlan.fat || '—'}g`,
          60, y
        );
        y += 24;
      }

      const meals = nutritionPlan.meals || [];
      for (const meal of meals) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill(BRAND.black).text(`${meal.name || meal.time || 'Meal'}:`, 60, y);
        y += 16;
        const items = meal.items || meal.foods || [];
        for (const item of items) {
          doc.fontSize(9).fill(BRAND.grey).text(`  — ${typeof item === 'string' ? item : item.name || item}`, 70, y);
          y += 14;
        }
        y += 8;
      }
    }

    // Notes
    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke(BRAND.lightGrey);
      y += 15;
      doc.fontSize(12).fill(BRAND.gold).text('COACH NOTES', 50, y, { characterSpacing: 2 });
      y += 24;
      doc.fontSize(10).fill(BRAND.grey).text(notes, 60, y, { width: doc.page.width - 120 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey).text(
        'fitnessbymaddy.com | Confidential — prepared exclusively for ' + clientName,
        50, doc.page.height - 30,
        { align: 'center', width: doc.page.width - 100 }
      );
    }

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getClient();
  const path = `${clientId}/week_${weekNo}.pdf`;

  const { error } = await db.storage
    .from('clients')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = db.storage.from('clients').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { generateProgramPDF, uploadPDF };
