const PDFDocument = require('pdfkit');
const { getClient } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  charcoal: '#2C2C2C',
  midGrey: '#6B6B6B'
};

function createProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill(BRAND.black);
    doc.fillColor('#FFFFFF')
      .fontSize(28)
      .font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fontSize(12)
      .font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 65, { align: 'left' });
    doc.fillColor(BRAND.gold)
      .fontSize(12)
      .text(client.name || 'Client', 350, 30, { align: 'right' });
    doc.fillColor('#FFFFFF')
      .fontSize(10)
      .text(client.program || '', 350, 50, { align: 'right' });

    doc.fillColor(BRAND.charcoal);
    let y = 130;

    doc.fillColor(BRAND.gold).fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    doc.fillColor(BRAND.charcoal).fontSize(10).font('Helvetica');
    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.font('Helvetica-Bold').fontSize(12)
          .text(day.name || day.day || '', 50, y);
        y += 18;
        doc.font('Helvetica').fontSize(10);
        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `${ex.name} — ${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`;
            doc.text(line, 70, y);
            y += 15;
            if (y > 720) { doc.addPage(); y = 50; }
          }
        }
        y += 10;
        if (y > 720) { doc.addPage(); y = 50; }
      }
    }

    y += 20;
    if (y > 600) { doc.addPage(); y = 50; }
    doc.fillColor(BRAND.gold).fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    doc.fillColor(BRAND.charcoal).fontSize(10).font('Helvetica');
    if (nutrition) {
      if (nutrition.calories) {
        doc.font('Helvetica-Bold').text(`Daily Calories: ${nutrition.calories}`, 50, y);
        y += 18;
      }
      if (nutrition.macros) {
        doc.text(`Protein: ${nutrition.macros.protein || ''}g | Carbs: ${nutrition.macros.carbs || ''}g | Fat: ${nutrition.macros.fat || ''}g`, 50, y);
        y += 18;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.font('Helvetica-Bold').text(meal.name || '', 50, y);
          y += 15;
          doc.font('Helvetica');
          if (meal.items) {
            for (const item of meal.items) {
              doc.text(`  - ${item}`, 70, y);
              y += 14;
              if (y > 720) { doc.addPage(); y = 50; }
            }
          }
          y += 8;
        }
      }
    }

    if (notes) {
      y += 20;
      if (y > 650) { doc.addPage(); y = 50; }
      doc.fillColor(BRAND.gold).fontSize(14).font('Helvetica-Bold')
        .text('NOTES', 50, y);
      y += 20;
      doc.fillColor(BRAND.charcoal).fontSize(10).font('Helvetica')
        .text(notes, 50, y, { width: 500 });
    }

    const pageCount = doc.bufferedPageRange().count;
    doc.fillColor(BRAND.midGrey).fontSize(8).font('Helvetica');
    doc.text(
      'fitnessbymaddy.com | This program is for personal use only.',
      50, 760, { align: 'center', width: 500 }
    );

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const db = getClient();
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

module.exports = { createProgramPDF, uploadPDF };
