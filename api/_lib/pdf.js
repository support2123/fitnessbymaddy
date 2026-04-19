const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const CHARCOAL = '#2C2C2C';
const GOLD = '#B8965A';
const CREAM = '#FAF8F4';
const MID_GREY = '#6B6B6B';

async function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        const fileName = `clients/${client.id}/week_${weekNo}.pdf`;

        const { data, error } = await supabase.storage
          .from('programs')
          .upload(fileName, buffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (error) return reject(error);

        const { data: urlData } = supabase.storage
          .from('programs')
          .getPublicUrl(fileName);

        resolve(urlData.publicUrl);
      });

      // Header bar
      doc.rect(0, 0, doc.page.width, 80).fill(CHARCOAL);
      doc.fontSize(24).fill('#FFFFFF').font('Helvetica-Bold')
        .text('FITNESS BY MADDY', 50, 28, { characterSpacing: 3 });

      // Week banner
      doc.rect(0, 80, doc.page.width, 40).fill(GOLD);
      doc.fontSize(12).fill('#FFFFFF').font('Helvetica-Bold')
        .text(`WEEK ${weekNo} PROGRAM — ${client.name?.toUpperCase() || 'CLIENT'}`, 50, 92, { characterSpacing: 2 });

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
            .text(day.name?.toUpperCase() || 'DAY', 50, y);
          y += 18;

          if (day.exercises) {
            for (const ex of day.exercises) {
              if (y > 720) { doc.addPage(); y = 50; }
              doc.fontSize(10).fill(CHARCOAL).font('Helvetica')
                .text(`• ${ex.name}`, 60, y);
              doc.fill(MID_GREY)
                .text(`${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 280, y);
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
        for (const meal of nutritionPlan.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(12).fill(GOLD).font('Helvetica-Bold')
            .text(meal.name?.toUpperCase() || 'MEAL', 50, y);
          y += 18;
          doc.fontSize(10).fill(CHARCOAL).font('Helvetica')
            .text(meal.description || '', 60, y, { width: 485 });
          y += doc.heightOfString(meal.description || '', { width: 485 }) + 8;
          if (meal.macros) {
            doc.fontSize(9).fill(MID_GREY)
              .text(`Protein: ${meal.macros.protein || '-'} | Carbs: ${meal.macros.carbs || '-'} | Fats: ${meal.macros.fats || '-'}`, 60, y);
            y += 16;
          }
          y += 6;
        }
      } else if (nutritionPlan) {
        doc.fontSize(10).fill(MID_GREY).font('Helvetica')
          .text(JSON.stringify(nutritionPlan, null, 2), 50, y, { width: 495 });
        y += 100;
      }

      // Notes
      if (notes) {
        if (y > 650) { doc.addPage(); y = 50; }
        y += 20;
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
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateProgramPDF };
