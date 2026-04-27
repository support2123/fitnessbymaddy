const PDFDocument = require('pdfkit');

const BRAND = {
  black: '#2C2C2C',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(24).fill('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(3);
    doc.fontSize(10).fill(BRAND.grey)
      .text(`Client: ${client.name || 'N/A'}`, 50, 100);
    doc.text(`Program: ${formatProgram(client.program)}`, 50, 115);
    doc.text(`Week: ${weekNo}`, 50, 130);

    // Divider
    doc.moveTo(50, 150).lineTo(545, 150).stroke(BRAND.gold);

    // Workout section
    let y = 170;
    doc.fontSize(16).fill(BRAND.black)
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(12).fill(BRAND.gold).text(day.name || 'Day', 50, y);
        y += 18;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(BRAND.black)
              .text(`${ex.name}`, 70, y);
            doc.fill(BRAND.grey)
              .text(`${ex.sets || ''}x${ex.reps || ''} ${ex.notes || ''}`, 300, y);
            y += 16;
          }
        }
        y += 10;
      }
    } else {
      doc.fontSize(10).fill(BRAND.grey).text('No workout data available.', 50, y);
      y += 20;
    }

    // Nutrition section
    if (y > 650) { doc.addPage(); y = 50; }
    y += 20;
    doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.lightGrey);
    y += 20;
    doc.fontSize(16).fill(BRAND.black).text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(10).fill(BRAND.black).text(`Daily Calories: ${nutrition.calories} kcal`, 50, y);
        y += 18;
      }
      if (nutrition.macros) {
        doc.fill(BRAND.grey).text(
          `Protein: ${nutrition.macros.protein || '-'}g  |  Carbs: ${nutrition.macros.carbs || '-'}g  |  Fats: ${nutrition.macros.fats || '-'}g`,
          50, y
        );
        y += 18;
      }
      if (nutrition.meals) {
        y += 10;
        for (const meal of nutrition.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(BRAND.gold).text(meal.name || 'Meal', 50, y);
          y += 16;
          doc.fontSize(10).fill(BRAND.grey).text(meal.description || '', 70, y, { width: 460 });
          y += doc.heightOfString(meal.description || '', { width: 460 }) + 8;
        }
      }
    } else {
      doc.fontSize(10).fill(BRAND.grey).text('No nutrition data available.', 50, y);
      y += 20;
    }

    // Notes
    if (notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.moveTo(50, y).lineTo(545, y).stroke(BRAND.lightGrey);
      y += 20;
      doc.fontSize(12).fill(BRAND.black).text('NOTES', 50, y);
      y += 20;
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, y, { width: 495 });
    }

    // Footer on each page
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey)
        .text('fitnessbymaddy.com | Confidential — prepared exclusively for you', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code;
}

module.exports = { generateProgramPDF };
