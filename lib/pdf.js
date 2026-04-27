const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const GOLD = '#B8965A';
const CHARCOAL = '#2C2C2C';
const MID_GREY = '#6B6B6B';
const CREAM = '#FAF8F4';

async function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(CHARCOAL);
    doc.fontSize(24).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 28, { characterSpacing: 3 });

    // Week banner
    doc.rect(0, 80, 595, 40).fill(GOLD);
    doc.fontSize(12).fill('#FFFFFF').font('Helvetica-Bold')
      .text(`WEEK ${weekNo} PROGRAM — ${clientName.toUpperCase()}`, 50, 92, { characterSpacing: 2 });

    let y = 150;

    // Workout section
    doc.fontSize(16).fill(CHARCOAL).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    doc.moveTo(50, y).lineTo(545, y).stroke(GOLD);
    y += 15;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(12).fill(GOLD).font('Helvetica-Bold')
          .text(day.name || 'Training Day', 50, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(CHARCOAL).font('Helvetica')
              .text(`• ${ex.name}`, 65, y);
            doc.fontSize(9).fill(MID_GREY).font('Helvetica')
              .text(`${ex.sets} sets × ${ex.reps} reps${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, 300, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(10).fill(MID_GREY).font('Helvetica')
        .text(JSON.stringify(workoutPlan, null, 2), 50, y, { width: 495 });
      y += 100;
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fontSize(16).fill(CHARCOAL).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).stroke(GOLD);
    y += 15;

    if (nutritionPlan && nutritionPlan.meals) {
      if (nutritionPlan.calories) {
        doc.fontSize(10).fill(CHARCOAL).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal | P: ${nutritionPlan.protein || '—'}g | C: ${nutritionPlan.carbs || '—'}g | F: ${nutritionPlan.fats || '—'}g`, 50, y);
        y += 22;
      }
      for (const meal of nutritionPlan.meals) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill(GOLD).font('Helvetica-Bold')
          .text(meal.name || 'Meal', 50, y);
        y += 16;
        if (meal.items) {
          for (const item of meal.items) {
            doc.fontSize(10).fill(CHARCOAL).font('Helvetica')
              .text(`• ${item}`, 65, y, { width: 480 });
            y += 14;
          }
        }
        y += 8;
      }
    } else {
      doc.fontSize(10).fill(MID_GREY).font('Helvetica')
        .text(JSON.stringify(nutritionPlan, null, 2), 50, y, { width: 495 });
    }

    // Notes
    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 25;
      doc.fontSize(12).fill(CHARCOAL).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill(MID_GREY).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer on every page
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(MID_GREY).font('Helvetica')
        .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
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

module.exports = { generateProgramPDF, uploadPDF };
