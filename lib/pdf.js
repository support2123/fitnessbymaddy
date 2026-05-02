const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1A1A1A',
  gold: '#B8965A',
  darkGrey: '#2C2C2C',
  midGrey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  cream: '#FAF8F4',
  white: '#FFFFFF',
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover page
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.black);
    doc.fillColor(COLORS.gold)
      .fontSize(14)
      .font('Helvetica')
      .text('FITNESS BY MADDY', 50, 60, { characterSpacing: 4 });

    doc.fillColor(COLORS.white)
      .fontSize(48)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, 50, 200);

    doc.fillColor(COLORS.gold)
      .fontSize(20)
      .font('Helvetica')
      .text('TRAINING & NUTRITION PLAN', 50, 260);

    doc.fillColor(COLORS.midGrey)
      .fontSize(14)
      .text(`Prepared for: ${client.name || 'Client'}`, 50, 320);

    doc.fillColor(COLORS.midGrey)
      .fontSize(12)
      .text(`Program: ${formatProgram(client.program)}`, 50, 345);

    doc.fillColor(COLORS.midGrey)
      .text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 50, 365);

    // Workout plan pages
    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        doc.addPage();
        renderDayHeader(doc, day.name || day.day);

        let y = 140;
        if (day.exercises) {
          // Table header
          doc.fillColor(COLORS.gold).fontSize(9).font('Helvetica-Bold');
          doc.text('EXERCISE', 50, y);
          doc.text('SETS', 300, y);
          doc.text('REPS', 370, y);
          doc.text('REST', 440, y);
          y += 20;

          doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.lightGrey).stroke();
          y += 10;

          doc.font('Helvetica').fontSize(10).fillColor(COLORS.darkGrey);
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              y = 60;
            }
            doc.text(ex.name || '', 50, y, { width: 240 });
            doc.text(String(ex.sets || ''), 300, y);
            doc.text(String(ex.reps || ''), 370, y);
            doc.text(ex.rest || '', 440, y);
            y += 22;
          }
        }

        if (day.notes) {
          y += 15;
          doc.fillColor(COLORS.midGrey).fontSize(9).font('Helvetica-Oblique');
          doc.text(day.notes, 50, y, { width: 495 });
        }
      }
    }

    // Nutrition plan page
    if (nutritionPlan) {
      doc.addPage();
      renderDayHeader(doc, 'NUTRITION PLAN');

      let y = 140;
      if (nutritionPlan.calories) {
        doc.fillColor(COLORS.gold).fontSize(11).font('Helvetica-Bold');
        doc.text('DAILY TARGETS', 50, y);
        y += 25;
        doc.fillColor(COLORS.darkGrey).fontSize(10).font('Helvetica');
        doc.text(`Calories: ${nutritionPlan.calories} kcal`, 50, y); y += 18;
        if (nutritionPlan.protein) { doc.text(`Protein: ${nutritionPlan.protein}g`, 50, y); y += 18; }
        if (nutritionPlan.carbs) { doc.text(`Carbs: ${nutritionPlan.carbs}g`, 50, y); y += 18; }
        if (nutritionPlan.fats) { doc.text(`Fats: ${nutritionPlan.fats}g`, 50, y); y += 18; }
        y += 15;
      }

      if (nutritionPlan.meals) {
        doc.fillColor(COLORS.gold).fontSize(11).font('Helvetica-Bold');
        doc.text('MEAL PLAN', 50, y);
        y += 25;

        for (const meal of nutritionPlan.meals) {
          if (y > 700) { doc.addPage(); y = 60; }
          doc.fillColor(COLORS.darkGrey).fontSize(10).font('Helvetica-Bold');
          doc.text(meal.name || '', 50, y); y += 16;
          doc.fillColor(COLORS.midGrey).fontSize(9).font('Helvetica');
          if (meal.items) {
            for (const item of meal.items) {
              doc.text(`  - ${item}`, 60, y, { width: 480 }); y += 14;
            }
          }
          y += 10;
        }
      }

      if (nutritionPlan.notes) {
        y += 10;
        doc.fillColor(COLORS.midGrey).fontSize(9).font('Helvetica-Oblique');
        doc.text(nutritionPlan.notes, 50, y, { width: 495 });
      }
    }

    // Notes page
    if (notes) {
      doc.addPage();
      renderDayHeader(doc, 'COACH NOTES');
      doc.fillColor(COLORS.darkGrey).fontSize(11).font('Helvetica');
      doc.text(notes, 50, 140, { width: 495, lineGap: 6 });
    }

    // Footer on last page
    doc.fillColor(COLORS.midGrey).fontSize(8).font('Helvetica');
    doc.text('fitnessbymaddy.com | @fitnessbymaddy_', 50, 760, { align: 'center', width: 495 });

    doc.end();
  });
}

function renderDayHeader(doc, title) {
  doc.rect(0, 0, doc.page.width, 110).fill(COLORS.black);
  doc.fillColor(COLORS.gold).fontSize(10).font('Helvetica')
    .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 3 });
  doc.fillColor(COLORS.white).fontSize(28).font('Helvetica-Bold')
    .text(title, 50, 55);
}

function formatProgram(program) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
  };
  return map[program] || program;
}

module.exports = { generateProgramPDF };
