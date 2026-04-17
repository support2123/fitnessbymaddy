const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  charcoal: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function buildProgramPdf(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.goldLight)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.midGrey).font('Helvetica')
      .text(`Client: ${client.name || 'N/A'}`, 50, 100);
    doc.text(`Program: ${formatProgram(client.program)}`, 50, 115);
    doc.text(`Week: ${weekNo}`, 50, 130);

    // Divider
    doc.moveTo(50, 150).lineTo(545, 150).stroke(BRAND.goldLight);

    // Workout Plan
    let y = 170;
    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || day.day, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica-Bold')
              .text(`${ex.name}`, 60, y);
            doc.font('Helvetica').fill(BRAND.midGrey)
              .text(`${ex.sets || ''} x ${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 60, y + 13);
            if (ex.notes) {
              doc.fontSize(9).fill(BRAND.midGrey)
                .text(ex.notes, 60, y + 26, { width: 480 });
              y += 12;
            }
            y += 30;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.lightGrey);
    y += 20;
    doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50, y);
        y += 18;
        if (nutritionPlan.macros) {
          doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
            .text(`Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`, 50, y);
          y += 20;
        }
      }
      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.charcoal).font('Helvetica-Bold')
            .text(meal.name, 60, y);
          y += 16;
          doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
            .text(meal.description || meal.items?.join(', ') || '', 60, y, { width: 480 });
          y += 20;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.lightGrey);
      y += 20;
      doc.fontSize(14).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 22;
      doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer on last page
    const pageH = doc.page.height;
    doc.fontSize(8).fill(BRAND.midGrey)
      .text('fitnessbymaddy.com | This program is personalised — do not redistribute.',
        50, pageH - 40, { align: 'center', width: 495 });

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    pcos: 'PCOS Warrior',
    '40plus': '40+ Strong',
    zoom_trial: 'Zoom Trial',
    zoom_pack: 'Zoom Pack',
  };
  return map[code] || code || 'Custom Program';
}

async function uploadPdf(clientId, weekNo, buffer) {
  const path = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error } = await supabase.storage
    .from('programs')
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = supabase.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { buildProgramPdf, uploadPdf, formatProgram };
