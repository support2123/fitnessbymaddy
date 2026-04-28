const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

async function generateProgramPDF(clientName, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 100).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fill(BRAND.white).text(`Week ${weekNo} Program`, 50, 65);
    doc.fontSize(10).fill('#999').text(`Prepared for ${clientName}`, 50, 82);

    doc.moveDown(4);

    // Workout section
    doc.fontSize(18).fill(BRAND.black).text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke(BRAND.gold);
    doc.moveDown(0.8);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(BRAND.gold).text(day.name || day.day, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.black)
              .text(`  ${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`, 60);
          }
        }
        doc.moveDown(0.6);
      }
    } else if (typeof workout === 'string') {
      doc.fontSize(10).fill(BRAND.grey).text(workout, 50, doc.y, { width: 495 });
    }

    doc.moveDown(1.5);

    // Nutrition section
    doc.fontSize(18).fill(BRAND.black).text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke(BRAND.gold);
    doc.moveDown(0.8);

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill(BRAND.gold).text(meal.name || meal.meal, 50);
        doc.fontSize(10).fill(BRAND.grey).text(meal.description || meal.foods || '', 60);
        if (meal.calories) {
          doc.fontSize(9).fill('#999').text(`~${meal.calories} kcal`, 60);
        }
        doc.moveDown(0.4);
      }
      if (nutrition.daily_calories) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill(BRAND.black)
          .text(`Daily Target: ${nutrition.daily_calories} kcal | P: ${nutrition.protein || '—'}g | C: ${nutrition.carbs || '—'}g | F: ${nutrition.fat || '—'}g`, 50);
      }
    } else if (typeof nutrition === 'string') {
      doc.fontSize(10).fill(BRAND.grey).text(nutrition, 50, doc.y, { width: 495 });
    }

    if (notes) {
      doc.moveDown(1.5);
      doc.fontSize(14).fill(BRAND.black).text('COACH NOTES', 50);
      doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke(BRAND.gold);
      doc.moveDown(0.5);
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    const bottom = 780;
    doc.moveTo(50, bottom).lineTo(545, bottom).stroke('#ddd');
    doc.fontSize(8).fill('#999')
      .text('fitnessbymaddy.com | support@fitnessbymaddy.com', 50, bottom + 8, { align: 'center', width: 495 });

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getSupabase();
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
