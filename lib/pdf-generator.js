const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1A1A1A',
  gold: '#B8965A',
  charcoal: '#2C2C2C',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  cream: '#FAF8F4',
  white: '#FFFFFF'
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCoverPage(doc, client, weekNo, plan);
    drawWorkoutPages(doc, plan.workout_plan);
    drawNutritionPage(doc, plan.nutrition_plan);

    if (plan.coach_note) {
      drawNotePage(doc, plan.coach_note);
    }

    doc.end();
  });
}

function drawCoverPage(doc, client, weekNo, plan) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.charcoal);

  doc.rect(50, 50, doc.page.width - 100, 3).fill(COLORS.gold);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gold);
  doc.text('FITNESS BY MADDY', 50, 80, { characterSpacing: 4 });

  doc.font('Helvetica-Bold').fontSize(42).fillColor(COLORS.white);
  doc.text(`WEEK ${weekNo}`, 50, 200);

  doc.font('Helvetica').fontSize(16).fillColor(COLORS.gold);
  doc.text('TRAINING & NUTRITION PROGRAM', 50, 260);

  doc.rect(50, 300, 80, 2).fill(COLORS.gold);

  doc.font('Helvetica').fontSize(13).fillColor('#AAAAAA');
  doc.text(`Prepared for: ${client.name || 'Client'}`, 50, 340);
  doc.text(`Program: ${formatProgramName(client.program)}`, 50, 365);
  doc.text(`Week ${weekNo} of 12`, 50, 390);

  const now = new Date();
  doc.text(`Generated: ${now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, 50, 415);

  if (plan.coach_note) {
    doc.rect(50, 480, doc.page.width - 100, 1).fill('#333333');
    doc.font('Helvetica-Oblique').fontSize(12).fillColor(COLORS.gold);
    doc.text(`"${plan.coach_note}"`, 50, 500, {
      width: doc.page.width - 100,
      align: 'center'
    });
  }

  doc.rect(50, doc.page.height - 70, doc.page.width - 100, 1).fill('#333333');
  doc.font('Helvetica').fontSize(9).fillColor('#666666');
  doc.text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 55, {
    width: doc.page.width - 100,
    align: 'center'
  });
}

function drawWorkoutPages(doc, workout) {
  if (!workout || !workout.days) return;

  for (const day of workout.days) {
    doc.addPage();

    doc.rect(0, 0, doc.page.width, 80).fill(COLORS.charcoal);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gold);
    doc.text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
    doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white);
    doc.text(`${day.day.toUpperCase()} — ${(day.focus || '').toUpperCase()}`, 50, 42);

    let y = 100;

    if (day.warmup) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gold);
      doc.text('WARM-UP', 50, y);
      y += 18;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.grey);
      doc.text(day.warmup, 50, y, { width: doc.page.width - 100 });
      y += 30;
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.grey);
    const colX = [50, 250, 340, 400, 460];
    doc.text('EXERCISE', colX[0], y);
    doc.text('SETS', colX[1], y);
    doc.text('REPS', colX[2], y);
    doc.text('REST', colX[3], y);
    doc.text('NOTES', colX[4], y);
    y += 5;
    doc.rect(50, y + 12, doc.page.width - 100, 1).fill(COLORS.lightGrey);
    y += 22;

    for (const ex of (day.exercises || [])) {
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }

      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.black);
      doc.text(ex.name || '', colX[0], y, { width: 190 });
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.charcoal);
      doc.text(String(ex.sets || ''), colX[1], y);
      doc.text(String(ex.reps || ''), colX[2], y);
      doc.text(String(ex.rest || ''), colX[3], y);
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.grey);
      doc.text(ex.notes || '', colX[4], y, { width: 80 });

      y += 24;
      doc.rect(50, y - 4, doc.page.width - 100, 0.5).fill('#F0EAE0');
    }

    if (day.cooldown) {
      y += 10;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gold);
      doc.text('COOL-DOWN', 50, y);
      y += 18;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.grey);
      doc.text(day.cooldown, 50, y, { width: doc.page.width - 100 });
    }
  }
}

function drawNutritionPage(doc, nutrition) {
  if (!nutrition) return;

  doc.addPage();

  doc.rect(0, 0, doc.page.width, 80).fill(COLORS.charcoal);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gold);
  doc.text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white);
  doc.text('NUTRITION PLAN', 50, 42);

  let y = 100;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gold);
  doc.text('DAILY TARGETS', 50, y);
  y += 22;

  const macros = [
    ['Calories', `${nutrition.calories || '—'} kcal`],
    ['Protein', `${nutrition.protein_g || '—'}g`],
    ['Carbs', `${nutrition.carbs_g || '—'}g`],
    ['Fat', `${nutrition.fat_g || '—'}g`]
  ];

  const boxWidth = (doc.page.width - 100 - 30) / 4;
  for (let i = 0; i < macros.length; i++) {
    const bx = 50 + i * (boxWidth + 10);
    doc.rect(bx, y, boxWidth, 50).lineWidth(1).stroke(COLORS.lightGrey);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.grey);
    doc.text(macros[i][0], bx + 10, y + 10);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.charcoal);
    doc.text(macros[i][1], bx + 10, y + 26);
  }
  y += 70;

  if (nutrition.meals) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gold);
    doc.text('MEAL PLAN', 50, y);
    y += 22;

    for (const meal of nutrition.meals) {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.charcoal);
      doc.text(`${meal.meal}${meal.time ? ` — ${meal.time}` : ''}`, 50, y);
      y += 18;

      for (const option of (meal.options || [])) {
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.grey);
        doc.text(`→ ${option}`, 65, y, { width: doc.page.width - 130 });
        y += 16;
      }
      y += 8;
    }
  }

  if (nutrition.supplements && nutrition.supplements.length > 0) {
    y += 10;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gold);
    doc.text('SUPPLEMENTS', 50, y);
    y += 22;

    for (const supp of nutrition.supplements) {
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.grey);
      doc.text(`→ ${supp}`, 65, y);
      y += 16;
    }
  }

  if (nutrition.hydration) {
    y += 15;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.gold);
    doc.text('HYDRATION', 50, y);
    y += 20;
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.grey);
    doc.text(nutrition.hydration, 65, y);
  }
}

function drawNotePage(doc, note) {
  doc.addPage();

  doc.rect(0, 0, doc.page.width, 80).fill(COLORS.charcoal);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.gold);
  doc.text('FITNESS BY MADDY', 50, 20, { characterSpacing: 3 });
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white);
  doc.text("COACH'S NOTE", 50, 42);

  doc.font('Helvetica').fontSize(13).fillColor(COLORS.charcoal);
  doc.text(note, 50, 120, {
    width: doc.page.width - 100,
    lineGap: 8
  });
}

function formatProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}

module.exports = { generatePDF };
