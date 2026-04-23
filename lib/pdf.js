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

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(BRAND.black);
    doc.fontSize(28).fill('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 4 });
    doc.fontSize(10).fill(BRAND.gold)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fontSize(10).fill(BRAND.grey)
      .text(`Client: ${client.name || 'Client'}`, 50, 100);
    doc.text(`Program: ${formatProgramName(client.program)}`, 50, 115);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 130);

    // Divider
    doc.moveTo(50, 150).lineTo(545, 150).strokeColor(BRAND.gold).lineWidth(1).stroke();

    // Workout plan
    let y = 170;
    doc.fontSize(18).fill(BRAND.black)
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
    y += 30;

    if (workout && workout.days) {
      for (const day of workout.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc.fontSize(12).fill(BRAND.gold).text(day.name || 'Day', 50, y);
        y += 18;
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              y = 50;
            }
            doc.fontSize(10).fill(BRAND.black)
              .text(`${ex.name}`, 70, y);
            doc.fill(BRAND.grey)
              .text(`${ex.sets} x ${ex.reps} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 300, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition plan
    doc.addPage();
    y = 50;
    doc.rect(0, 0, doc.page.width, 50).fill(BRAND.black);
    doc.fontSize(18).fill('#FFFFFF')
      .text('NUTRITION PLAN', 50, 15, { characterSpacing: 2 });
    y = 70;

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(12).fill(BRAND.gold).text('Daily Targets', 50, y);
        y += 20;
        doc.fontSize(10).fill(BRAND.black)
          .text(`Calories: ${nutrition.calories} kcal`, 70, y);
        y += 16;
        if (nutrition.protein) {
          doc.text(`Protein: ${nutrition.protein}g | Carbs: ${nutrition.carbs}g | Fat: ${nutrition.fat}g`, 70, y);
          y += 16;
        }
        y += 10;
      }

      if (nutrition.meals) {
        doc.fontSize(12).fill(BRAND.gold).text('Meal Plan', 50, y);
        y += 20;
        for (const meal of nutrition.meals) {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
          doc.fontSize(10).fill(BRAND.black).text(meal.name || 'Meal', 70, y);
          y += 14;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(9).fill(BRAND.grey).text(`  - ${item}`, 85, y);
              y += 13;
            }
          }
          y += 8;
        }
      }
    }

    // Notes
    if (notes) {
      y += 20;
      if (y > 650) { doc.addPage(); y = 50; }
      doc.moveTo(50, y).lineTo(545, y).strokeColor(BRAND.lightGrey).stroke();
      y += 15;
      doc.fontSize(12).fill(BRAND.gold).text('COACH NOTES', 50, y, { characterSpacing: 1 });
      y += 20;
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, y, { width: 495 });
    }

    // Footer
    const lastPage = doc.bufferedPageRange();
    doc.fontSize(8).fill(BRAND.grey)
      .text('fitnessbymaddy.com | Confidential — for personal use only', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

function formatProgramName(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code || 'Custom Program';
}

module.exports = { generateProgramPDF, formatProgramName };
