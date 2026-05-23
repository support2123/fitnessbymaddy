const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B'
};

function generateProgramPDF(clientName, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65);

    doc.moveDown(3);

    doc.fontSize(14).fill(BRAND.black).font('Helvetica-Bold')
      .text(`Client: ${clientName}`);
    doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`);
    doc.moveDown(1.5);

    doc.fontSize(18).fill(BRAND.gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(BRAND.black).font('Helvetica-Bold')
          .text(day.name);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
              .text(`  ${ex.name} — ${ex.sets}x${ex.reps} ${ex.rest ? `(Rest: ${ex.rest})` : ''}`, {
                indent: 10
              });
          }
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(JSON.stringify(workout, null, 2));
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(1.5);

    doc.fontSize(18).fill(BRAND.gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN');
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (nutrition && nutrition.meals) {
      for (const meal of nutrition.meals) {
        doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
          .text(meal.name);
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(meal.items ? meal.items.join(', ') : meal.description || '');
        doc.moveDown(0.3);
      }
      if (nutrition.macros) {
        doc.moveDown(0.5);
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text('Daily Macros:');
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Calories: ${nutrition.macros.calories || 'TBD'} | Protein: ${nutrition.macros.protein || 'TBD'}g | Carbs: ${nutrition.macros.carbs || 'TBD'}g | Fat: ${nutrition.macros.fat || 'TBD'}g`);
      }
    } else {
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(JSON.stringify(nutrition, null, 2));
    }

    if (notes) {
      doc.moveDown(1.5);
      doc.fontSize(14).fill(BRAND.gold).font('Helvetica-Bold')
        .text('COACH NOTES');
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes);
    }

    const pageH = doc.page.height;
    doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, pageH - 40, { align: 'center' });

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getSupabase();
  const path = `clients/${clientId}/week_${weekNo}.pdf`;

  const { error } = await db.storage
    .from('programs')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = db.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { generateProgramPDF, uploadPDF };
