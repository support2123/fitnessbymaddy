const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF',
};

function generateProgramPdf(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCoverPage(doc, client, weekNo);
    drawWorkoutPages(doc, workoutPlan);
    drawNutritionPage(doc, nutritionPlan);
    if (notes) drawNotesPage(doc, notes, weekNo);

    doc.end();
  });
}

function drawCoverPage(doc, client, weekNo) {
  doc.rect(0, 0, 595, 842).fill(COLORS.black);

  doc.rect(40, 40, 515, 762).lineWidth(1).stroke(COLORS.gold);

  doc.fontSize(12).fillColor(COLORS.gold)
    .text('FITNESS BY MADDY', 50, 80, { align: 'center', characterSpacing: 6 });

  doc.moveTo(200, 110).lineTo(395, 110).lineWidth(0.5).stroke(COLORS.gold);

  doc.fontSize(48).fillColor(COLORS.white)
    .text('WEEK', 50, 280, { align: 'center' });
  doc.fontSize(120).fillColor(COLORS.gold)
    .text(String(weekNo), 50, 320, { align: 'center' });

  doc.fontSize(14).fillColor(COLORS.goldLight)
    .text('YOUR CUSTOM PROGRAM', 50, 500, { align: 'center', characterSpacing: 4 });

  doc.moveTo(200, 540).lineTo(395, 540).lineWidth(0.5).stroke(COLORS.gold);

  doc.fontSize(16).fillColor(COLORS.white)
    .text((client.name || 'Client').toUpperCase(), 50, 570, { align: 'center', characterSpacing: 3 });

  doc.fontSize(10).fillColor(COLORS.grey)
    .text(`${client.program || '12-Week Program'} • Generated ${new Date().toLocaleDateString('en-IN')}`, 50, 600, { align: 'center' });
}

function drawWorkoutPages(doc, workoutPlan) {
  if (!workoutPlan || !workoutPlan.days) return;

  doc.addPage();
  drawPageHeader(doc, 'WORKOUT PLAN');

  let y = 120;
  for (const day of workoutPlan.days) {
    if (y > 720) {
      doc.addPage();
      drawPageHeader(doc, 'WORKOUT PLAN (CONTINUED)');
      y = 120;
    }

    doc.rect(50, y, 495, 28).fill(COLORS.gold);
    doc.fontSize(11).fillColor(COLORS.white)
      .text(day.name.toUpperCase(), 60, y + 8, { characterSpacing: 2 });
    y += 28;

    if (day.focus) {
      doc.fontSize(9).fillColor(COLORS.grey)
        .text(`Focus: ${day.focus}`, 60, y + 6);
      y += 22;
    }

    if (day.exercises) {
      for (const ex of day.exercises) {
        if (y > 740) {
          doc.addPage();
          drawPageHeader(doc, 'WORKOUT PLAN (CONTINUED)');
          y = 120;
        }

        doc.rect(50, y, 495, 1).fill('#E8E3DC');
        y += 4;

        doc.fontSize(10).fillColor(COLORS.black)
          .text(ex.name, 60, y);
        doc.fillColor(COLORS.grey)
          .text(`${ex.sets} × ${ex.reps}${ex.rest ? ' | Rest: ' + ex.rest : ''}`, 350, y, { width: 190, align: 'right' });
        y += 20;

        if (ex.notes) {
          doc.fontSize(8).fillColor(COLORS.grey)
            .text(ex.notes, 70, y);
          y += 14;
        }
      }
    }

    if (day.rest) {
      doc.fontSize(10).fillColor(COLORS.grey)
        .text('REST DAY — Active recovery recommended', 60, y + 4);
      y += 22;
    }

    y += 16;
  }
}

function drawNutritionPage(doc, nutritionPlan) {
  if (!nutritionPlan) return;

  doc.addPage();
  drawPageHeader(doc, 'NUTRITION PLAN');

  let y = 120;

  if (nutritionPlan.summary) {
    doc.fontSize(10).fillColor(COLORS.black)
      .text(nutritionPlan.summary, 50, y, { width: 495 });
    y += doc.heightOfString(nutritionPlan.summary, { width: 495 }) + 20;
  }

  if (nutritionPlan.macros) {
    const m = nutritionPlan.macros;
    doc.rect(50, y, 495, 60).fill('#F5F0E8');

    doc.fontSize(9).fillColor(COLORS.grey)
      .text('DAILY TARGETS', 60, y + 8, { characterSpacing: 2 });

    const macroText = `Calories: ${m.calories || '—'}  |  Protein: ${m.protein || '—'}  |  Carbs: ${m.carbs || '—'}  |  Fats: ${m.fats || '—'}`;
    doc.fontSize(12).fillColor(COLORS.black)
      .text(macroText, 60, y + 28);
    y += 80;
  }

  if (nutritionPlan.meals) {
    for (const meal of nutritionPlan.meals) {
      if (y > 720) {
        doc.addPage();
        drawPageHeader(doc, 'NUTRITION PLAN (CONTINUED)');
        y = 120;
      }

      doc.rect(50, y, 495, 24).fill(COLORS.gold);
      doc.fontSize(10).fillColor(COLORS.white)
        .text(meal.name.toUpperCase(), 60, y + 7, { characterSpacing: 2 });
      y += 24;

      if (meal.time) {
        doc.fontSize(8).fillColor(COLORS.grey).text(meal.time, 60, y + 4);
        y += 16;
      }

      if (meal.options) {
        for (const opt of meal.options) {
          doc.fontSize(10).fillColor(COLORS.black).text(`• ${opt}`, 60, y + 2, { width: 475 });
          y += doc.heightOfString(`• ${opt}`, { width: 475 }) + 6;
        }
      }

      y += 12;
    }
  }

  if (nutritionPlan.hydration) {
    doc.fontSize(10).fillColor(COLORS.gold).text('HYDRATION', 50, y, { characterSpacing: 2 });
    y += 18;
    doc.fontSize(10).fillColor(COLORS.black).text(nutritionPlan.hydration, 50, y, { width: 495 });
  }
}

function drawNotesPage(doc, notes, weekNo) {
  doc.addPage();
  drawPageHeader(doc, `WEEK ${weekNo} NOTES`);

  doc.fontSize(11).fillColor(COLORS.black)
    .text(notes, 50, 130, { width: 495, lineGap: 6 });

  const y = 750;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).stroke(COLORS.gold);
  doc.fontSize(8).fillColor(COLORS.grey)
    .text('Generated by Fitness by Maddy • fitnessbymaddy.com', 50, y + 10, { align: 'center' });
}

function drawPageHeader(doc, title) {
  doc.rect(0, 0, 595, 90).fill(COLORS.black);
  doc.fontSize(10).fillColor(COLORS.gold)
    .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 4 });
  doc.fontSize(22).fillColor(COLORS.white)
    .text(title, 50, 48, { characterSpacing: 3 });
}

module.exports = { generateProgramPdf };
