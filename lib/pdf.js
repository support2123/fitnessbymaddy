const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#6B6B6B',
  cream: '#FAF8F4',
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 100).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fill(BRAND.white).font('Helvetica')
      .text(`Week ${weekNo} Program · ${client.name || 'Client'}`, 50, 65);

    doc.moveDown(3);

    // Program info
    doc.fill(BRAND.black).fontSize(10).font('Helvetica')
      .text(`Program: ${formatProgram(client.program)}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`);
    doc.moveDown(1.5);

    // Workout section
    doc.fontSize(18).fill(BRAND.gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(13).fill(BRAND.black).font('Helvetica-Bold')
          .text(day.name);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
              .text(`→ ${ex.name}  ·  ${ex.sets}×${ex.reps}  ·  Rest ${ex.rest || '60s'}`, 70);
          }
        }

        if (day.notes) {
          doc.fontSize(9).fill(BRAND.grey).font('Helvetica-Oblique')
            .text(day.notes, 70);
        }
        doc.moveDown(0.8);
      }
    }

    // Nutrition section
    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
    doc.moveDown(0.5);

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`);
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${nutritionPlan.protein || '—'}g  ·  Carbs: ${nutritionPlan.carbs || '—'}g  ·  Fat: ${nutritionPlan.fat || '—'}g`);
        doc.moveDown(0.8);
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
            .text(meal.name);
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
                .text(`→ ${item}`, 70);
            }
          }
          doc.moveDown(0.5);
        }
      }
    }

    // Notes
    if (notes) {
      if (doc.y > 680) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(18).fill(BRAND.gold).font('Helvetica-Bold')
        .text('COACH NOTES');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.gold);
      doc.moveDown(0.5);
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica').text(notes);
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey)
        .text('fitnessbymaddy.com  ·  Confidential — For client use only', 50, 780, { align: 'center' });
    }

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, buffer) {
  const path = `${clientId}/week_${weekNo}.pdf`;
  const { error } = await supabase.storage
    .from('clients')
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('clients').getPublicUrl(path);
  return data.publicUrl;
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    pcos: 'PCOS Warrior',
    '40plus': '40+ Strong',
    zoom_trial: 'Zoom Trial',
    zoom_pack: 'Zoom Pack',
  };
  return map[code] || code;
}

module.exports = { generateProgramPDF, uploadPDF };
