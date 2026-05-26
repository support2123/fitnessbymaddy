const PDFDocument = require('pdfkit');
const supabase = require('./supabase');

const GOLD = '#B8965A';
const CHARCOAL = '#2C2C2C';
const MID_GREY = '#6B6B6B';

async function generateProgramPDF(clientId, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      const fileName = `clients/${clientId}/week_${weekNo}.pdf`;

      const { error } = await supabase.storage
        .from('clients')
        .upload(`${clientId}/week_${weekNo}.pdf`, buffer, {
          contentType: 'application/pdf',
          upsert: true
        });

      if (error) {
        reject(error);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('clients')
        .getPublicUrl(`${clientId}/week_${weekNo}.pdf`);

      resolve(urlData.publicUrl || fileName);
    });
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(CHARCOAL);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(GOLD)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    doc.moveDown(3);

    // Workout section
    doc.fontSize(18).fill(GOLD).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 200, 2).fill(GOLD);
    doc.moveDown(1);

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.fontSize(13).fill(CHARCOAL).font('Helvetica-Bold')
          .text(day.name || day.day, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(MID_GREY).font('Helvetica')
              .text(`  ${ex.name}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 60);
            if (ex.notes) {
              doc.fontSize(9).fill('#999999').text(`    ${ex.notes}`, 70);
            }
          }
        }

        if (day.notes) {
          doc.fontSize(9).fill(MID_GREY).font('Helvetica-Oblique')
            .text(`  Note: ${day.notes}`, 60);
        }

        doc.moveDown(0.8);

        if (doc.y > 700) {
          doc.addPage();
        }
      }
    } else if (typeof workoutPlan === 'string') {
      doc.fontSize(10).fill(MID_GREY).font('Helvetica').text(workoutPlan, 50);
    }

    doc.addPage();

    // Nutrition section
    doc.fontSize(18).fill(GOLD).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.rect(50, doc.y, 200, 2).fill(GOLD);
    doc.moveDown(1);

    if (nutritionPlan && nutritionPlan.overview) {
      doc.fontSize(11).fill(CHARCOAL).font('Helvetica-Bold')
        .text('Daily Targets', 50);
      doc.fontSize(10).fill(MID_GREY).font('Helvetica')
        .text(`Calories: ${nutritionPlan.overview.calories || 'As prescribed'}`, 60);
      doc.text(`Protein: ${nutritionPlan.overview.protein || '-'}`, 60);
      doc.text(`Carbs: ${nutritionPlan.overview.carbs || '-'}`, 60);
      doc.text(`Fats: ${nutritionPlan.overview.fats || '-'}`, 60);
      doc.moveDown(1);
    }

    if (nutritionPlan && nutritionPlan.meals) {
      for (const meal of nutritionPlan.meals) {
        doc.fontSize(12).fill(CHARCOAL).font('Helvetica-Bold')
          .text(meal.name || meal.time, 50);
        doc.moveDown(0.3);

        if (meal.options) {
          for (const opt of meal.options) {
            doc.fontSize(10).fill(MID_GREY).font('Helvetica')
              .text(`  ${opt}`, 60);
          }
        }
        if (meal.description) {
          doc.fontSize(10).fill(MID_GREY).font('Helvetica')
            .text(`  ${meal.description}`, 60);
        }
        doc.moveDown(0.6);
      }
    } else if (typeof nutritionPlan === 'string') {
      doc.fontSize(10).fill(MID_GREY).font('Helvetica').text(nutritionPlan, 50);
    }

    // Notes section
    if (notes) {
      doc.moveDown(1);
      doc.fontSize(14).fill(GOLD).font('Helvetica-Bold')
        .text('COACH NOTES', 50);
      doc.moveDown(0.5);
      doc.fontSize(10).fill(MID_GREY).font('Helvetica')
        .text(notes, 50, undefined, { width: 495 });
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fill('#CCCCCC').font('Helvetica')
      .text('This program is personalized for you by Fitness by Maddy. Do not redistribute.', 50, undefined, { align: 'center' });

    doc.end();
  });
}

module.exports = { generateProgramPDF };
