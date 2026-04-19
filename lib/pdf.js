import PDFDocument from 'pdfkit';

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#6B6B6B',
};

export async function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, client, weekNo);
    drawWorkoutPlan(doc, workout);
    drawNutritionPlan(doc, nutrition);
    if (notes) drawNotes(doc, notes);
    drawFooter(doc);

    doc.end();
  });
}

function drawHeader(doc, client, weekNo) {
  doc.rect(0, 0, doc.page.width, 120).fill(BRAND.black);

  doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
    .text('FITNESS BY MADDY', 50, 30);

  doc.fontSize(14).fill(BRAND.white).font('Helvetica')
    .text(`${client.name || 'Client'} — Week ${weekNo}`, 50, 70);

  const programLabel = formatProgram(client.program);
  doc.fontSize(10).fill(BRAND.goldLight)
    .text(programLabel.toUpperCase(), 50, 92);

  doc.moveDown(3);
}

function drawWorkoutPlan(doc, workout) {
  doc.y = 140;
  sectionTitle(doc, 'WORKOUT PLAN');

  if (!workout || !workout.days) {
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text('Rest week — follow recovery protocol.', 50);
    doc.moveDown(1);
    return;
  }

  for (const day of workout.days) {
    if (doc.y > 680) doc.addPage();

    doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
      .text(day.name.toUpperCase(), 50);
    doc.moveDown(0.3);

    if (day.focus) {
      doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
        .text(`Focus: ${day.focus}`, 50);
      doc.moveDown(0.3);
    }

    if (day.exercises) {
      for (const ex of day.exercises) {
        doc.fontSize(10).fill(BRAND.black).font('Helvetica')
          .text(`${ex.name}  —  ${ex.sets}x${ex.reps}  ${ex.rest || ''}`, 70);
        if (ex.note) {
          doc.fontSize(8).fill(BRAND.grey).text(`    ${ex.note}`, 70);
        }
      }
    }
    doc.moveDown(0.8);
  }
}

function drawNutritionPlan(doc, nutrition) {
  if (doc.y > 600) doc.addPage();
  sectionTitle(doc, 'NUTRITION PLAN');

  if (!nutrition) {
    doc.fontSize(11).fill(BRAND.grey).font('Helvetica')
      .text('Continue current nutrition plan.', 50);
    return;
  }

  if (nutrition.calories) {
    doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
      .text(`Daily Target: ${nutrition.calories} kcal`, 50);
    if (nutrition.protein) {
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(`P: ${nutrition.protein}g  |  C: ${nutrition.carbs || '—'}g  |  F: ${nutrition.fats || '—'}g`, 50);
    }
    doc.moveDown(0.5);
  }

  if (nutrition.meals) {
    for (const meal of nutrition.meals) {
      if (doc.y > 700) doc.addPage();
      doc.fontSize(10).fill(BRAND.gold).font('Helvetica-Bold')
        .text(meal.name, 50);
      doc.fontSize(10).fill(BRAND.black).font('Helvetica')
        .text(meal.description, 70, undefined, { width: 450 });
      doc.moveDown(0.5);
    }
  }

  if (nutrition.notes) {
    doc.moveDown(0.3);
    doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
      .text(nutrition.notes, 50, undefined, { width: 480 });
  }
}

function drawNotes(doc, notes) {
  if (doc.y > 680) doc.addPage();
  doc.moveDown(1);
  sectionTitle(doc, 'COACH NOTES');
  doc.fontSize(10).fill(BRAND.black).font('Helvetica')
    .text(notes, 50, undefined, { width: 480 });
}

function drawFooter(doc) {
  const bottom = doc.page.height - 40;
  doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
    .text('fitnessbymaddy.com  |  @fitnessbymaddyy  |  Confidential — do not share', 50, bottom, {
      align: 'center',
      width: doc.page.width - 100,
    });
}

function sectionTitle(doc, title) {
  doc.rect(50, doc.y, 495, 1).fill(BRAND.goldLight);
  doc.moveDown(0.4);
  doc.fontSize(14).fill(BRAND.black).font('Helvetica-Bold')
    .text(title, 50);
  doc.moveDown(0.5);
}

function formatProgram(program) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    pcos: 'PCOS Warrior',
    '40plus': '40+ Strong',
    zoom_trial: 'Zoom Trial',
    zoom_pack: 'Zoom Pack',
  };
  return map[program] || program || 'Custom Program';
}
