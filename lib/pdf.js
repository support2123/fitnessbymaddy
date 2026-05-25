const PDFDocument = require('pdfkit');

const BRAND_BLACK = '#1A1A1A';
const BRAND_GOLD = '#B8965A';
const WHITE = '#FFFFFF';
const LIGHT_GRAY = '#F5F5F5';
const TEXT_GRAY = '#333333';

const PAGE_MARGIN = 50;

/**
 * Draw the branded header bar on a page.
 */
function drawHeader(doc, title) {
  doc
    .rect(0, 0, doc.page.width, 100)
    .fill(BRAND_BLACK);

  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(BRAND_GOLD)
    .text('FITNESS BY MADDY', PAGE_MARGIN, 25, {
      width: doc.page.width - PAGE_MARGIN * 2,
    });

  doc
    .font('Helvetica')
    .fontSize(12)
    .fillColor(WHITE)
    .text(title, PAGE_MARGIN, 60, {
      width: doc.page.width - PAGE_MARGIN * 2,
    });
}

/**
 * Draw the gold accent line below header.
 */
function drawAccentLine(doc, y) {
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor(BRAND_GOLD)
    .lineWidth(2)
    .stroke();
}

/**
 * Render the cover page.
 */
function renderCoverPage(doc, clientName, weekNo) {
  // Full black background
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(BRAND_BLACK);

  // Brand name
  doc
    .font('Helvetica-Bold')
    .fontSize(36)
    .fillColor(BRAND_GOLD)
    .text('FITNESS BY MADDY', 0, 200, {
      align: 'center',
      width: doc.page.width,
    });

  // Gold divider
  const centerX = doc.page.width / 2;
  doc
    .moveTo(centerX - 80, 260)
    .lineTo(centerX + 80, 260)
    .strokeColor(BRAND_GOLD)
    .lineWidth(2)
    .stroke();

  // Client name
  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor(WHITE)
    .text(clientName.toUpperCase(), 0, 290, {
      align: 'center',
      width: doc.page.width,
    });

  // Week number
  doc
    .font('Helvetica')
    .fontSize(16)
    .fillColor(BRAND_GOLD)
    .text(`WEEK ${weekNo}`, 0, 340, {
      align: 'center',
      width: doc.page.width,
    });

  // Personalized program label
  doc
    .font('Helvetica')
    .fontSize(12)
    .fillColor(WHITE)
    .text('Your Personalized Training & Nutrition Program', 0, 380, {
      align: 'center',
      width: doc.page.width,
    });
}

/**
 * Render the workout plan page.
 * workoutPlan shape: { days: [{ day, focus, exercises: [{ name, sets, reps, rest, notes }] }] }
 */
function renderWorkoutPage(doc, workoutPlan) {
  doc.addPage();
  drawHeader(doc, 'WORKOUT PLAN');

  let y = 120;

  if (!workoutPlan || !workoutPlan.days) {
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(TEXT_GRAY)
      .text('No workout plan available.', PAGE_MARGIN, y);
    return;
  }

  for (const day of workoutPlan.days) {
    // Check if we need a new page (leave room for at least a day header + 1 exercise)
    if (y > doc.page.height - 150) {
      doc.addPage();
      drawHeader(doc, 'WORKOUT PLAN (continued)');
      y = 120;
    }

    // Day header with gold background strip
    doc
      .rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 28)
      .fill(BRAND_GOLD);

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(WHITE)
      .text(`${day.day} — ${day.focus}`, PAGE_MARGIN + 10, y + 7, {
        width: doc.page.width - PAGE_MARGIN * 2 - 20,
      });

    y += 38;

    // Exercise table header
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(TEXT_GRAY);

    const colX = {
      name: PAGE_MARGIN + 10,
      sets: PAGE_MARGIN + 220,
      reps: PAGE_MARGIN + 270,
      rest: PAGE_MARGIN + 330,
      notes: PAGE_MARGIN + 380,
    };

    doc.text('EXERCISE', colX.name, y);
    doc.text('SETS', colX.sets, y);
    doc.text('REPS', colX.reps, y);
    doc.text('REST', colX.rest, y);
    doc.text('NOTES', colX.notes, y);

    y += 16;
    drawAccentLine(doc, y);
    y += 8;

    // Exercise rows
    if (day.exercises && day.exercises.length > 0) {
      for (const ex of day.exercises) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          drawHeader(doc, 'WORKOUT PLAN (continued)');
          y = 120;
        }

        // Alternating row background
        const rowIndex = day.exercises.indexOf(ex);
        if (rowIndex % 2 === 0) {
          doc
            .rect(PAGE_MARGIN, y - 2, doc.page.width - PAGE_MARGIN * 2, 18)
            .fill(LIGHT_GRAY);
        }

        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(TEXT_GRAY);

        doc.text(ex.name || '', colX.name, y, { width: 200 });
        doc.text(String(ex.sets || ''), colX.sets, y);
        doc.text(String(ex.reps || ''), colX.reps, y);
        doc.text(ex.rest || '', colX.rest, y);
        doc.text(ex.notes || '', colX.notes, y, { width: 120 });

        y += 20;
      }
    }

    y += 15;
  }
}

/**
 * Render the nutrition plan page.
 * nutritionPlan shape: { daily_calories, protein_g, carbs_g, fat_g, meals: [{ meal, options: [string] }] }
 */
function renderNutritionPage(doc, nutritionPlan) {
  doc.addPage();
  drawHeader(doc, 'NUTRITION PLAN');

  let y = 120;

  if (!nutritionPlan) {
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(TEXT_GRAY)
      .text('No nutrition plan available.', PAGE_MARGIN, y);
    return;
  }

  // Macro summary box
  doc
    .rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 70)
    .fill(BRAND_BLACK);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(BRAND_GOLD)
    .text('DAILY TARGETS', PAGE_MARGIN + 15, y + 10);

  const macroY = y + 32;
  const macros = [
    { label: 'Calories', value: nutritionPlan.daily_calories || '—' },
    { label: 'Protein', value: `${nutritionPlan.protein_g || '—'}g` },
    { label: 'Carbs', value: `${nutritionPlan.carbs_g || '—'}g` },
    { label: 'Fat', value: `${nutritionPlan.fat_g || '—'}g` },
  ];

  const macroSpacing = (doc.page.width - PAGE_MARGIN * 2 - 30) / macros.length;
  macros.forEach((macro, i) => {
    const mx = PAGE_MARGIN + 15 + i * macroSpacing;
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(WHITE)
      .text(macro.label, mx, macroY);
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(BRAND_GOLD)
      .text(String(macro.value), mx, macroY + 14);
  });

  y += 90;

  // Meals
  if (nutritionPlan.meals && nutritionPlan.meals.length > 0) {
    for (const meal of nutritionPlan.meals) {
      if (y > doc.page.height - 100) {
        doc.addPage();
        drawHeader(doc, 'NUTRITION PLAN (continued)');
        y = 120;
      }

      // Meal header
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(BRAND_GOLD)
        .text(meal.meal, PAGE_MARGIN, y);

      y += 20;

      if (meal.options && meal.options.length > 0) {
        meal.options.forEach((option, idx) => {
          if (y > doc.page.height - 40) {
            doc.addPage();
            drawHeader(doc, 'NUTRITION PLAN (continued)');
            y = 120;
          }

          doc
            .font('Helvetica')
            .fontSize(10)
            .fillColor(TEXT_GRAY)
            .text(`Option ${idx + 1}: ${option}`, PAGE_MARGIN + 15, y, {
              width: doc.page.width - PAGE_MARGIN * 2 - 30,
            });

          y += 18;
        });
      }

      y += 10;
    }
  }
}

/**
 * Generate a branded PDF program for a client.
 *
 * @param {string} clientName - The client's display name
 * @param {number} weekNo - Current program week number
 * @param {object} workoutPlan - Workout plan object (see renderWorkoutPage for shape)
 * @param {object} nutritionPlan - Nutrition plan object (see renderNutritionPage for shape)
 * @returns {Promise<Buffer>} The generated PDF as a Buffer
 */
async function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      info: {
        Title: `Fitness by Maddy — ${clientName} Week ${weekNo}`,
        Author: 'Fitness by Maddy',
        Subject: 'Personalized Training & Nutrition Program',
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      renderCoverPage(doc, clientName, weekNo);
      renderWorkoutPage(doc, workoutPlan);
      renderNutritionPage(doc, nutritionPlan);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateProgramPDF };
