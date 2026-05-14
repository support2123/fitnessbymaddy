import PDFDocument from 'pdfkit';
import supabase from './supabase.js';

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
};

function drawHeader(doc, clientName, weekNo, programName) {
  doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);
  doc.fill(BRAND.gold).fontSize(10).font('Helvetica').text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
  doc.fill('#FFFFFF').fontSize(24).font('Helvetica-Bold').text(`Week ${weekNo} Program`, 50, 55);
  doc.fill(BRAND.gold).fontSize(11).font('Helvetica').text(`${clientName} — ${programName}`, 50, 90);
}

function drawSectionTitle(doc, title, y) {
  doc.fill(BRAND.gold).rect(50, y, 3, 20).fill(BRAND.gold);
  doc.fill(BRAND.black).fontSize(16).font('Helvetica-Bold').text(title, 62, y + 2);
  return y + 35;
}

function drawWorkoutDay(doc, day, exercises, startY) {
  let y = startY;

  if (y > 680) {
    doc.addPage();
    y = 50;
  }

  doc.fill(BRAND.black).fontSize(12).font('Helvetica-Bold').text(day, 50, y);
  y += 20;

  for (const ex of exercises) {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.fill(BRAND.black).fontSize(10).font('Helvetica').text(
      `${ex.name}  —  ${ex.sets} x ${ex.reps}${ex.rest ? `  (Rest: ${ex.rest})` : ''}`,
      70, y
    );
    if (ex.notes) {
      y += 14;
      doc.fill(BRAND.grey).fontSize(9).text(`↳ ${ex.notes}`, 80, y);
    }
    y += 18;
  }

  return y + 10;
}

function drawNutritionSection(doc, nutrition, startY) {
  let y = startY;

  if (y > 600) {
    doc.addPage();
    y = 50;
  }

  y = drawSectionTitle(doc, 'NUTRITION PLAN', y);

  if (nutrition.calories) {
    doc.fill(BRAND.black).fontSize(11).font('Helvetica-Bold').text(
      `Daily Target: ${nutrition.calories} kcal`, 50, y
    );
    y += 20;
  }

  if (nutrition.macros) {
    const m = nutrition.macros;
    doc.fill(BRAND.grey).fontSize(10).font('Helvetica').text(
      `Protein: ${m.protein}g  |  Carbs: ${m.carbs}g  |  Fats: ${m.fats}g`, 50, y
    );
    y += 25;
  }

  if (nutrition.meals && nutrition.meals.length > 0) {
    for (const meal of nutrition.meals) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.fill(BRAND.black).fontSize(10).font('Helvetica-Bold').text(meal.name, 50, y);
      y += 16;
      if (meal.items) {
        for (const item of meal.items) {
          doc.fill(BRAND.grey).fontSize(9).font('Helvetica').text(`• ${item}`, 65, y);
          y += 14;
        }
      }
      y += 6;
    }
  }

  if (nutrition.notes) {
    y += 10;
    doc.fill(BRAND.grey).fontSize(9).font('Helvetica').text(
      `Note: ${nutrition.notes}`, 50, y, { width: 500 }
    );
  }

  return y;
}

export async function generateProgramPDF(clientId, clientName, weekNo, programName, workoutPlan, nutritionPlan) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const filePath = `clients/${clientId}/week_${weekNo}.pdf`;

          const { error } = await supabase.storage
            .from('client-files')
            .upload(filePath, buffer, {
              contentType: 'application/pdf',
              upsert: true,
            });

          if (error) {
            reject(new Error(`Storage upload failed: ${error.message}`));
            return;
          }

          const { data: urlData } = supabase.storage
            .from('client-files')
            .getPublicUrl(filePath);

          resolve({
            pdf_url: urlData.publicUrl,
            file_path: filePath,
          });
        } catch (err) {
          reject(err);
        }
      });

      drawHeader(doc, clientName, weekNo, programName);

      let y = 150;
      y = drawSectionTitle(doc, 'WORKOUT PLAN', y);

      if (workoutPlan.days) {
        for (const day of workoutPlan.days) {
          y = drawWorkoutDay(doc, day.day, day.exercises, y);
        }
      }

      y += 20;
      drawNutritionSection(doc, nutritionPlan, y);

      doc.addPage();
      doc.rect(0, doc.page.height - 80, doc.page.width, 80).fill(BRAND.black);
      doc.fill(BRAND.gold).fontSize(10).font('Helvetica').text(
        'FITNESS BY MADDY  |  fitnessbymaddy.com  |  @fitnessbymaddy_',
        50, doc.page.height - 55,
        { align: 'center', width: doc.page.width - 100 }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
