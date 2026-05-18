const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#CCCCCC',
  cream: '#FAF8F4'
};

function buildPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover section
    doc.rect(0, 0, 595, 842).fill(BRAND.black);
    doc.fontSize(12).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 60, { characterSpacing: 4 });
    doc.moveTo(50, 85).lineTo(200, 85).strokeColor(BRAND.gold).lineWidth(1).stroke();
    doc.fontSize(42).fillColor(BRAND.white).text(`WEEK ${weekNo}`, 50, 300);
    doc.fontSize(16).fillColor(BRAND.goldLight).text('PERSONALIZED PROGRAM', 50, 355, { characterSpacing: 2 });
    doc.fontSize(14).fillColor(BRAND.grey).text(client.name || 'Client', 50, 400);
    const programLabel = (client.program || '').replace(/_/g, ' ').toUpperCase();
    doc.fontSize(11).text(programLabel, 50, 425);

    // Workout page
    doc.addPage({ margin: 50 });
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(10).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
    doc.fontSize(18).fillColor(BRAND.white).text('WORKOUT PLAN', 50, 42);

    let y = 100;
    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage({ margin: 50 }); y = 60; }
        doc.rect(45, y - 5, 505, 24).fill(BRAND.black);
        doc.fontSize(11).fillColor(BRAND.gold).text(day.name || 'Day', 55, y);
        y += 30;
        if (day.focus) {
          doc.fontSize(9).fillColor(BRAND.grey).text(day.focus, 55, y);
          y += 18;
        }
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 750) { doc.addPage({ margin: 50 }); y = 60; }
            doc.fontSize(10).fillColor(BRAND.black).text(ex.name || '', 65, y, { width: 250 });
            const detail = [ex.sets, ex.reps, ex.rest].filter(Boolean).join(' | ');
            doc.fontSize(9).fillColor('#666').text(detail, 330, y, { width: 220, align: 'right' });
            y += 20;
            if (ex.notes) {
              doc.fontSize(8).fillColor('#999').text(ex.notes, 75, y, { width: 460 });
              y += 16;
            }
          }
        }
        y += 10;
      }
    }

    // Nutrition page
    doc.addPage({ margin: 50 });
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(10).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
    doc.fontSize(18).fillColor(BRAND.white).text('NUTRITION PLAN', 50, 42);

    y = 100;
    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(10).fillColor(BRAND.black).text(`Daily Target: ${nutritionPlan.calories} kcal`, 55, y);
        y += 20;
        const macros = `Protein: ${nutritionPlan.protein || '?'}g  |  Carbs: ${nutritionPlan.carbs || '?'}g  |  Fats: ${nutritionPlan.fats || '?'}g`;
        doc.fontSize(9).fillColor('#666').text(macros, 55, y);
        y += 30;
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage({ margin: 50 }); y = 60; }
          doc.rect(45, y - 5, 505, 22).fill(BRAND.black);
          doc.fontSize(10).fillColor(BRAND.gold).text(meal.name || 'Meal', 55, y);
          y += 28;
          if (meal.items) {
            for (const item of meal.items) {
              if (y > 750) { doc.addPage({ margin: 50 }); y = 60; }
              doc.fontSize(9).fillColor(BRAND.black).text(`• ${item}`, 65, y, { width: 460 });
              y += 16;
            }
          }
          y += 8;
        }
      }
    }

    // Notes page
    if (notes) {
      doc.addPage({ margin: 50 });
      doc.rect(0, 0, 595, 80).fill(BRAND.black);
      doc.fontSize(10).fillColor(BRAND.gold).text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
      doc.fontSize(18).fillColor(BRAND.white).text('COACH NOTES', 50, 42);
      doc.fontSize(10).fillColor(BRAND.black).text(notes, 55, 100, { width: 480, lineGap: 6 });
    }

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getSupabase();
  const path = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error } = await db.storage
    .from('programs')
    .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`PDF upload failed: ${error.message}`);
  const { data } = db.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { buildPDF, uploadPDF };
