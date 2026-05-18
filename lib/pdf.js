const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  charcoal: '#2C2C2C',
  midGrey: '#6B6B6B',
};

async function generateProgramPDF(clientId, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        const db = getSupabase();
        const path = `clients/${clientId}/week_${weekNo}.pdf`;

        const { error } = await db.storage
          .from('programs')
          .upload(path, buffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (error) {
          reject(error);
          return;
        }

        const { data: urlData } = db.storage
          .from('programs')
          .getPublicUrl(path);

        resolve(urlData.publicUrl);
      });

      // Header
      doc.rect(0, 0, 595, 100).fill(BRAND.black);
      doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
        .text('FITNESS BY MADDY', 50, 30);
      doc.fontSize(12).fill('#ffffff').font('Helvetica')
        .text(`WEEK ${weekNo} PROGRAM`, 50, 65);

      doc.moveDown(3);

      // Workout section
      doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50);
      doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).stroke(BRAND.gold);
      doc.moveDown(0.5);

      if (workoutPlan && workoutPlan.days) {
        for (const day of workoutPlan.days) {
          doc.fontSize(13).fill(BRAND.gold).font('Helvetica-Bold')
            .text(day.name || day.day, 50);
          doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
            .text(day.focus || '', 50);
          doc.moveDown(0.3);

          if (day.exercises) {
            for (const ex of day.exercises) {
              doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
                .text(`  • ${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 60);
            }
          }
          doc.moveDown(0.5);

          if (doc.y > 700) doc.addPage();
        }
      } else if (typeof workoutPlan === 'string') {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
          .text(workoutPlan, 50, doc.y, { width: 495 });
      }

      doc.addPage();

      // Nutrition section
      doc.fontSize(18).fill(BRAND.charcoal).font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50);
      doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).stroke(BRAND.gold);
      doc.moveDown(0.5);

      if (nutritionPlan && nutritionPlan.meals) {
        doc.fontSize(11).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text(`Daily Targets: ${nutritionPlan.calories || '—'} kcal | P: ${nutritionPlan.protein || '—'}g | C: ${nutritionPlan.carbs || '—'}g | F: ${nutritionPlan.fats || '—'}g`, 50);
        doc.moveDown(0.5);

        for (const meal of nutritionPlan.meals) {
          doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50);
          doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
            .text(meal.description || '', 60, doc.y, { width: 485 });
          if (meal.options) {
            for (const opt of meal.options) {
              doc.text(`  • ${opt}`, 70);
            }
          }
          doc.moveDown(0.5);
        }
      } else if (typeof nutritionPlan === 'string') {
        doc.fontSize(10).fill(BRAND.charcoal).font('Helvetica')
          .text(nutritionPlan, 50, doc.y, { width: 495 });
      }

      // Notes
      if (notes) {
        doc.moveDown(1);
        doc.fontSize(14).fill(BRAND.charcoal).font('Helvetica-Bold')
          .text('COACH NOTES', 50);
        doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).stroke(BRAND.gold);
        doc.moveDown(0.3);
        doc.fontSize(10).fill(BRAND.midGrey).font('Helvetica')
          .text(notes, 50, doc.y, { width: 495 });
      }

      // Footer
      doc.fontSize(8).fill(BRAND.midGrey).font('Helvetica')
        .text('© Fitness by Maddy — fitnessbymaddy.com', 50, 770, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateProgramPDF };
