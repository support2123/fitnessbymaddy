import PDFDocument from 'pdfkit';
import supabase from './supabase.js';

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

export async function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        const filePath = `clients/${client.id}/week_${weekNo}.pdf`;

        const { error } = await supabase.storage
          .from('programs')
          .upload(filePath, buffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (error) {
          reject(error);
          return;
        }

        const { data: urlData } = supabase.storage
          .from('programs')
          .getPublicUrl(filePath);

        resolve(urlData.publicUrl);
      });

      // Cover page
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);
      doc.fill(BRAND.gold).fontSize(12).font('Helvetica-Bold')
        .text('FITNESS BY MADDY', 50, 60, { characterSpacing: 4 });
      doc.fill('#FFFFFF').fontSize(42).font('Helvetica-Bold')
        .text(`WEEK ${weekNo}`, 50, doc.page.height / 2 - 60);
      doc.fill(BRAND.gold).fontSize(16).font('Helvetica')
        .text('YOUR CUSTOM PROGRAM', 50, doc.page.height / 2);
      doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
        .text(client.name || 'Client', 50, doc.page.height / 2 + 40);
      doc.fill(BRAND.grey).fontSize(10)
        .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, doc.page.height - 80);

      // Workout page
      doc.addPage();
      drawHeader(doc, 'WORKOUT PLAN');
      let y = 120;

      if (workoutPlan && workoutPlan.days) {
        for (const day of workoutPlan.days) {
          if (y > 700) { doc.addPage(); y = 60; }
          doc.fill(BRAND.gold).fontSize(13).font('Helvetica-Bold')
            .text(day.name.toUpperCase(), 50, y);
          y += 20;

          if (day.exercises) {
            for (const ex of day.exercises) {
              if (y > 720) { doc.addPage(); y = 60; }
              doc.fill(BRAND.black).fontSize(11).font('Helvetica-Bold')
                .text(ex.name, 70, y);
              doc.fill(BRAND.grey).fontSize(10).font('Helvetica')
                .text(`${ex.sets} sets × ${ex.reps} reps${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, 70, y + 14);
              if (ex.notes) {
                doc.fill(BRAND.grey).fontSize(9).font('Helvetica-Oblique')
                  .text(ex.notes, 70, y + 28, { width: 450 });
                y += 14;
              }
              y += 32;
            }
          }
          y += 10;
        }
      }

      // Nutrition page
      doc.addPage();
      drawHeader(doc, 'NUTRITION PLAN');
      y = 120;

      if (nutritionPlan) {
        if (nutritionPlan.calories) {
          doc.fill(BRAND.black).fontSize(12).font('Helvetica-Bold')
            .text(`Daily Target: ${nutritionPlan.calories} kcal`, 50, y);
          y += 20;
          if (nutritionPlan.macros) {
            doc.fill(BRAND.grey).fontSize(10).font('Helvetica')
              .text(`Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`, 50, y);
            y += 30;
          }
        }

        if (nutritionPlan.meals) {
          for (const meal of nutritionPlan.meals) {
            if (y > 700) { doc.addPage(); y = 60; }
            doc.fill(BRAND.gold).fontSize(11).font('Helvetica-Bold')
              .text(meal.name.toUpperCase(), 50, y);
            y += 18;
            if (meal.options) {
              for (const opt of meal.options) {
                doc.fill(BRAND.black).fontSize(10).font('Helvetica')
                  .text(`• ${opt}`, 70, y, { width: 450 });
                y += 16;
              }
            }
            y += 8;
          }
        }
      }

      // Notes page
      if (notes) {
        doc.addPage();
        drawHeader(doc, 'COACH NOTES');
        doc.fill(BRAND.black).fontSize(11).font('Helvetica')
          .text(notes, 50, 120, { width: 500, lineGap: 6 });
      }

      // Footer on last page
      doc.fill(BRAND.gold).fontSize(9).font('Helvetica')
        .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawHeader(doc, title) {
  doc.rect(0, 0, doc.page.width, 80).fill(BRAND.black);
  doc.fill(BRAND.gold).fontSize(10).font('Helvetica-Bold')
    .text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
  doc.fill('#FFFFFF').fontSize(22).font('Helvetica-Bold')
    .text(title, 50, 42, { characterSpacing: 2 });
}
