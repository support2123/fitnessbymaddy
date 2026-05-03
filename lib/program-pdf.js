const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  white: '#FFFFFF',
  grey: '#6B6B6B',
};

async function generateProgramPDF(clientId, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        const db = getSupabase();
        const path = `${clientId}/week_${weekNo}.pdf`;

        const { error } = await db.storage
          .from('clients')
          .upload(path, buffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (error) {
          reject(error);
          return;
        }

        const { data: urlData } = db.storage
          .from('clients')
          .getPublicUrl(path);

        resolve(urlData.publicUrl);
      });

      renderCover(doc, weekNo);
      doc.addPage();
      renderWorkoutPlan(doc, workoutPlan);
      doc.addPage();
      renderNutritionPlan(doc, nutritionPlan);

      if (notes) {
        doc.addPage();
        renderNotes(doc, notes);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderCover(doc, weekNo) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);

  doc
    .fontSize(14)
    .fill(BRAND.gold)
    .text('FITNESS BY MADDY', 50, 60, { characterSpacing: 4 });

  const lineY = 90;
  doc
    .moveTo(50, lineY)
    .lineTo(200, lineY)
    .strokeColor(BRAND.gold)
    .lineWidth(1)
    .stroke();

  doc
    .fontSize(48)
    .fill(BRAND.white)
    .text(`WEEK ${weekNo}`, 50, doc.page.height / 2 - 60);

  doc
    .fontSize(16)
    .fill(BRAND.goldLight)
    .text('YOUR CUSTOMISED PROGRAM', 50, doc.page.height / 2 + 10, {
      characterSpacing: 2,
    });

  doc
    .fontSize(10)
    .fill(BRAND.grey)
    .text('Personalised for your goals. Built by science.', 50, doc.page.height - 80);
}

function renderWorkoutPlan(doc, plan) {
  doc
    .fontSize(24)
    .fill(BRAND.black)
    .text('WORKOUT PLAN', 50, 50, { characterSpacing: 2 });

  drawGoldLine(doc, 85);

  let y = 100;
  const days = Array.isArray(plan) ? plan : plan.days || [];

  for (const day of days) {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(14).fill(BRAND.gold).text(day.name || day.day || '', 50, y);
    y += 22;

    const exercises = day.exercises || [];
    for (const ex of exercises) {
      doc
        .fontSize(11)
        .fill(BRAND.black)
        .text(`• ${ex.name}`, 60, y);

      const detail = [ex.sets, ex.reps, ex.rest].filter(Boolean).join(' | ');
      if (detail) {
        doc.fontSize(9).fill(BRAND.grey).text(`  ${detail}`, 60, y + 14);
        y += 30;
      } else {
        y += 18;
      }
    }
    y += 10;
  }
}

function renderNutritionPlan(doc, plan) {
  doc
    .fontSize(24)
    .fill(BRAND.black)
    .text('NUTRITION PLAN', 50, 50, { characterSpacing: 2 });

  drawGoldLine(doc, 85);

  let y = 100;

  if (plan.calories) {
    doc.fontSize(12).fill(BRAND.gold).text(`Daily Target: ${plan.calories} kcal`, 50, y);
    y += 20;

    if (plan.macros) {
      doc
        .fontSize(10)
        .fill(BRAND.grey)
        .text(
          `Protein: ${plan.macros.protein}g | Carbs: ${plan.macros.carbs}g | Fat: ${plan.macros.fat}g`,
          50,
          y
        );
      y += 25;
    }
  }

  const meals = plan.meals || [];
  for (const meal of meals) {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(13).fill(BRAND.gold).text(meal.name || '', 50, y);
    y += 20;

    const items = meal.items || [];
    for (const item of items) {
      doc.fontSize(10).fill(BRAND.black).text(`• ${item}`, 60, y);
      y += 16;
    }
    y += 10;
  }
}

function renderNotes(doc, notes) {
  doc
    .fontSize(24)
    .fill(BRAND.black)
    .text("COACH'S NOTES", 50, 50, { characterSpacing: 2 });

  drawGoldLine(doc, 85);

  doc.fontSize(11).fill(BRAND.black).text(notes, 50, 100, {
    width: doc.page.width - 100,
    lineGap: 6,
  });
}

function drawGoldLine(doc, y) {
  doc
    .moveTo(50, y)
    .lineTo(doc.page.width - 50, y)
    .strokeColor(BRAND.gold)
    .lineWidth(1)
    .stroke();
}

module.exports = { generateProgramPDF };
