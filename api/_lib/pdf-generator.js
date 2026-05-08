const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#2C2C2C',
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
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text(`Prepared for: ${clientName}`, 50);
    doc.fontSize(9).fill(BRAND.grey)
      .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.lightGrey);

    // Workout Plan
    doc.moveDown(1);
    doc.fontSize(16).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.moveDown(0.5);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.moveDown(0.5);
        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name.toUpperCase(), 50);
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(day.focus || '', 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            const line = `• ${ex.name}  —  ${ex.sets}×${ex.reps}${ex.rest ? `  (Rest: ${ex.rest})` : ''}`;
            doc.fontSize(10).fill(BRAND.black).font('Helvetica').text(line, 65);
          }
        }

        if (doc.y > 700) { doc.addPage(); }
      }
    }

    // Nutrition Plan
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 50).fill(BRAND.black);
    doc.fontSize(16).fill('#FFFFFF').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 15, { characterSpacing: 2 });
    doc.moveDown(2);

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50);
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${nutritionPlan.protein || '—'}g  |  Carbs: ${nutritionPlan.carbs || '—'}g  |  Fat: ${nutritionPlan.fat || '—'}g`, 50);
        doc.moveDown(1);
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name.toUpperCase(), 50);
          doc.moveDown(0.3);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill(BRAND.black).font('Helvetica').text(`• ${opt}`, 65);
            }
          }
          doc.moveDown(0.5);
        }
      }
    }

    // Notes
    if (notes) {
      doc.moveDown(1);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke(BRAND.lightGrey);
      doc.moveDown(0.5);
      doc.fontSize(12).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, doc.y, { characterSpacing: 2 });
      doc.moveDown(0.3);
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica').text(notes, 50, doc.y, { width: 495 });
    }

    // Footer
    doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
      .text('© Fitness by Maddy — fitnessbymaddy.com', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const path = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error } = await supabase.storage
    .from('programs')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = supabase.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { generateProgramPDF, uploadPDF };
