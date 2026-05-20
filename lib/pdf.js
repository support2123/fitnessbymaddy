const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function buildPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(24).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`, 50, 100);
    doc.text(`Program: ${formatProgram(client.program)}`, 50, 116);
    doc.text(`Week: ${weekNo}`, 50, 132);

    // Gold separator
    doc.rect(50, 152, 495, 2).fill(BRAND.gold);

    // Workout section
    let y = 170;
    doc.fontSize(16).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name, 50, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(`${ex.name}  —  ${ex.sets} x ${ex.reps}`, 70, y);
            if (ex.notes) {
              doc.fontSize(8).fill(BRAND.grey)
                .text(`  ${ex.notes}`, 70, y + 12);
              y += 14;
            }
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    y += 10;
    doc.rect(50, y, 495, 2).fill(BRAND.gold);
    y += 16;
    doc.fontSize(16).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Calories: ${nutrition.calories} kcal`, 50, y);
        y += 20;
      }
      if (nutrition.macros) {
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${nutrition.macros.protein}g  |  Carbs: ${nutrition.macros.carbs}g  |  Fats: ${nutrition.macros.fats}g`, 50, y);
        y += 20;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 740) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50, y);
          y += 16;
          doc.fontSize(10).fill(BRAND.black).font('Helvetica')
            .text(meal.description, 70, y, { width: 460 });
          y += doc.heightOfString(meal.description, { width: 460 }) + 10;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      doc.rect(50, y, 495, 2).fill(BRAND.gold);
      y += 16;
      doc.fontSize(14).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 24;
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer
    const lastPage = doc.bufferedPageRange();
    doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
      .text('fitnessbymaddy.com | Confidential — Do not share', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Session Pack',
  };
  return map[code] || code || 'Custom Program';
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const path = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error } = await supabase.storage
    .from('programs')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = supabase.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { buildPDF, uploadPDF };
