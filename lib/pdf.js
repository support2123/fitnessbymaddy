const PDFDocument = require('pdfkit');
const { getSupabase } = require('./supabase');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

async function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        const db = getSupabase();
        const path = `clients/${client.id}/week_${weekNo}.pdf`;

        const { error } = await db.storage
          .from('programs')
          .upload(path, buffer, {
            contentType: 'application/pdf',
            upsert: true
          });

        if (error) {
          reject(new Error(`Storage upload failed: ${error.message}`));
          return;
        }

        const { data: urlData } = db.storage
          .from('programs')
          .getPublicUrl(path);

        resolve(urlData.publicUrl);
      });

      renderCover(doc, client, weekNo);
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

function renderCover(doc, client, weekNo) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND.black);

  doc.fill(BRAND.gold)
    .fontSize(12)
    .font('Helvetica')
    .text('FITNESS BY MADDY', 50, 60, { characterSpacing: 4 });

  doc.moveTo(50, 85).lineTo(200, 85).strokeColor(BRAND.gold).lineWidth(0.5).stroke();

  doc.fill('#FFFFFF')
    .fontSize(48)
    .font('Helvetica-Bold')
    .text(`WEEK ${weekNo}`, 50, 200);

  doc.fill(BRAND.goldLight)
    .fontSize(16)
    .font('Helvetica')
    .text('TRAINING & NUTRITION PROGRAM', 50, 260, { characterSpacing: 2 });

  doc.fill('rgba(255,255,255,0.6)')
    .fontSize(14)
    .font('Helvetica')
    .text(`Prepared for ${client.name || 'Client'}`, 50, 320);

  doc.fill('rgba(255,255,255,0.3)')
    .fontSize(11)
    .text(`Program: ${formatProgram(client.program)}`, 50, 350);

  doc.fill('rgba(255,255,255,0.3)')
    .fontSize(11)
    .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 370);

  doc.moveTo(50, doc.page.height - 80)
    .lineTo(200, doc.page.height - 80)
    .strokeColor(BRAND.gold).lineWidth(0.5).stroke();

  doc.fill(BRAND.gold)
    .fontSize(9)
    .text('fitnessbymaddy.com', 50, doc.page.height - 65, { characterSpacing: 2 });
}

function renderWorkoutPlan(doc, plan) {
  doc.fill(BRAND.gold).fontSize(10).font('Helvetica')
    .text('WORKOUT PLAN', 50, 50, { characterSpacing: 3 });
  doc.moveTo(50, 68).lineTo(200, 68).strokeColor(BRAND.gold).lineWidth(0.5).stroke();

  let y = 90;

  if (!plan || !plan.days) {
    doc.fill(BRAND.black).fontSize(12).text('No workout data available.', 50, y);
    return;
  }

  for (const day of plan.days) {
    if (y > 700) { doc.addPage(); y = 50; }

    doc.fill(BRAND.black).fontSize(14).font('Helvetica-Bold')
      .text(day.name || 'Training Day', 50, y);
    y += 20;

    if (day.focus) {
      doc.fill(BRAND.gold).fontSize(9).font('Helvetica')
        .text(day.focus.toUpperCase(), 50, y, { characterSpacing: 1 });
      y += 18;
    }

    if (day.exercises) {
      for (const ex of day.exercises) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fill(BRAND.black).fontSize(11).font('Helvetica')
          .text(`${ex.name}`, 70, y);
        doc.fill(BRAND.grey).fontSize(10)
          .text(`${ex.sets} x ${ex.reps}${ex.rest ? ` | Rest: ${ex.rest}` : ''}`, 300, y);
        y += 18;
        if (ex.note) {
          doc.fill(BRAND.grey).fontSize(9).font('Helvetica-Oblique')
            .text(ex.note, 80, y);
          y += 14;
        }
      }
    }
    y += 16;
  }
}

function renderNutritionPlan(doc, plan) {
  doc.fill(BRAND.gold).fontSize(10).font('Helvetica')
    .text('NUTRITION PLAN', 50, 50, { characterSpacing: 3 });
  doc.moveTo(50, 68).lineTo(200, 68).strokeColor(BRAND.gold).lineWidth(0.5).stroke();

  let y = 90;

  if (!plan) {
    doc.fill(BRAND.black).fontSize(12).text('No nutrition data available.', 50, y);
    return;
  }

  if (plan.calories) {
    doc.fill(BRAND.black).fontSize(13).font('Helvetica-Bold')
      .text('Daily Targets', 50, y);
    y += 22;
    doc.fill(BRAND.grey).fontSize(11).font('Helvetica')
      .text(`Calories: ${plan.calories} kcal`, 70, y); y += 16;
    if (plan.protein) { doc.text(`Protein: ${plan.protein}g`, 70, y); y += 16; }
    if (plan.carbs) { doc.text(`Carbs: ${plan.carbs}g`, 70, y); y += 16; }
    if (plan.fat) { doc.text(`Fat: ${plan.fat}g`, 70, y); y += 16; }
    y += 16;
  }

  if (plan.meals) {
    doc.fill(BRAND.black).fontSize(13).font('Helvetica-Bold')
      .text('Meal Plan', 50, y);
    y += 22;

    for (const meal of plan.meals) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fill(BRAND.black).fontSize(11).font('Helvetica-Bold')
        .text(meal.name, 70, y);
      y += 16;
      if (meal.items) {
        for (const item of meal.items) {
          doc.fill(BRAND.grey).fontSize(10).font('Helvetica')
            .text(`- ${item}`, 85, y);
          y += 14;
        }
      }
      y += 10;
    }
  }

  if (plan.notes) {
    y += 10;
    doc.fill(BRAND.black).fontSize(13).font('Helvetica-Bold')
      .text('Notes', 50, y);
    y += 20;
    doc.fill(BRAND.grey).fontSize(10).font('Helvetica')
      .text(plan.notes, 70, y, { width: 450 });
  }
}

function renderNotes(doc, notes) {
  doc.fill(BRAND.gold).fontSize(10).font('Helvetica')
    .text("COACH'S NOTES", 50, 50, { characterSpacing: 3 });
  doc.moveTo(50, 68).lineTo(200, 68).strokeColor(BRAND.gold).lineWidth(0.5).stroke();

  doc.fill(BRAND.black).fontSize(11).font('Helvetica')
    .text(notes, 50, 90, { width: 495, lineGap: 6 });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code;
}

module.exports = { generateProgramPDF };
