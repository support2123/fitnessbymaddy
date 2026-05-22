const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  cream: '#FAF8F4',
  charcoal: '#2C2C2C',
  midGrey: '#6B6B6B',
};

function createProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { align: 'left' });
    doc.fontSize(10).fill('#FFFFFF').font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { align: 'left' });

    // Client info
    doc.fill(BRAND.charcoal).fontSize(12).font('Helvetica-Bold')
      .text(`Client: ${client.name || 'N/A'}`, 50, 100);
    doc.fontSize(10).font('Helvetica').fill(BRAND.midGrey)
      .text(`Program: ${formatProgram(client.program)} | Week ${weekNo}`, 50, 118);

    // Gold divider
    doc.rect(50, 140, 495, 2).fill(BRAND.gold);

    let y = 160;

    // Workout section
    doc.fontSize(16).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || 'Training Day', 50, y);
        y += 18;
        if (day.focus) {
          doc.fontSize(9).fill(BRAND.midGrey).font('Helvetica')
            .text(`Focus: ${day.focus}`, 60, y);
          y += 14;
        }
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
              .text(`• ${ex.name}`, 70, y);
            doc.fontSize(9).fill(BRAND.midGrey)
              .text(`${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}${ex.notes ? ' | ' + ex.notes : ''}`, 250, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else if (workout) {
      doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
        .text(JSON.stringify(workout, null, 2), 60, y, { width: 475 });
      y += 100;
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    doc.rect(50, y, 495, 2).fill(BRAND.gold);
    y += 15;
    doc.fontSize(16).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text(`Daily Target: ${nutrition.calories} kcal`, 60, y);
        y += 18;
      }
      if (nutrition.macros) {
        doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
          .text(`Protein: ${nutrition.macros.protein || '—'}g | Carbs: ${nutrition.macros.carbs || '—'}g | Fat: ${nutrition.macros.fat || '—'}g`, 60, y);
        y += 20;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name || 'Meal', 60, y);
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
                .text(`• ${item}`, 70, y);
              y += 14;
            }
          }
          y += 8;
        }
      }
      if (nutrition.notes) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(9).fill(BRAND.midGrey).font('Helvetica')
          .text(`Notes: ${nutrition.notes}`, 60, y, { width: 475 });
        y += 30;
      }
    }

    // Coach notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.rect(50, y, 495, 2).fill(BRAND.gold);
      y += 15;
      doc.fontSize(12).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(notes, 60, y, { width: 475 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.midGrey).font('Helvetica')
        .text('fitnessbymaddy.com | Confidential — prepared exclusively for you', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return map[code] || code;
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const sb = getSupabase();
  const path = `${clientId}/week_${weekNo}.pdf`;

  const { error } = await sb.storage
    .from('clients')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = sb.storage.from('clients').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { createProgramPDF, uploadPDF };
