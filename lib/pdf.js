const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
      .text(`Client: ${client.name || 'Client'}`, 50, 100);
    doc.text(`Program: ${formatProgram(client.program)}`, 50, 115);
    doc.text(`Week: ${weekNo}`, 50, 130);

    doc.moveTo(50, 150).lineTo(545, 150).stroke(BRAND.gold);

    // Workout Plan
    let y = 170;
    doc.fontSize(16).fill(BRAND.black).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(12).fill(BRAND.gold).font('Helvetica-Bold')
          .text(day.name || 'Training Day', 50, y);
        y += 18;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.black).font('Helvetica')
              .text(`  ${ex.name}`, 60, y);
            doc.fill(BRAND.grey)
              .text(`${ex.sets} x ${ex.reps} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 300, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.gold);
    y += 20;

    doc.fontSize(16).fill(BRAND.black).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
          .text(`Daily Calories: ${nutrition.calories} kcal`, 50, y);
        y += 20;
      }
      if (nutrition.macros) {
        doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
          .text(`Protein: ${nutrition.macros.protein}g | Carbs: ${nutrition.macros.carbs}g | Fat: ${nutrition.macros.fat}g`, 50, y);
        y += 25;
      }
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold).font('Helvetica-Bold')
            .text(meal.name, 50, y);
          y += 16;
          doc.fontSize(10).fill(BRAND.black).font('Helvetica')
            .text(meal.description, 60, y, { width: 480 });
          y += doc.heightOfString(meal.description, { width: 480 }) + 8;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 650) { doc.addPage(); y = 50; }
      y += 20;
      doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.gold);
      y += 20;
      doc.fontSize(16).fill(BRAND.black).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 25;
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, y, { width: 495 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
        .text('Fitness by Maddy | fitnessbymaddy.com | Confidential', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function formatProgram(program) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return map[program] || program;
}

module.exports = { generateProgramPDF };
