const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 100).fill(COLORS.black);
    doc.fontSize(28).fillColor(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 30, { characterSpacing: 4 });
    doc.fontSize(12).fillColor(COLORS.goldLight)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65, { characterSpacing: 2 });

    // Client info
    doc.moveDown(2);
    doc.fillColor(COLORS.black);
    doc.fontSize(11).fillColor(COLORS.grey)
      .text(`Prepared for: ${client.name || 'Client'}`, 50, 120);
    doc.text(`Program: ${formatProgram(client.program)}`, 50, 138);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 156);

    // Divider
    doc.moveTo(50, 180).lineTo(545, 180).strokeColor(COLORS.gold).lineWidth(1).stroke();

    // Workout Plan
    let y = 200;
    doc.fontSize(18).fillColor(COLORS.black)
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 3 });
    y += 35;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        doc.rect(50, y, 495, 28).fill(COLORS.black);
        doc.fontSize(11).fillColor(COLORS.gold)
          .text(day.name.toUpperCase(), 60, y + 8, { characterSpacing: 1 });
        y += 36;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) {
              doc.addPage();
              y = 50;
            }
            doc.fontSize(10).fillColor(COLORS.black)
              .text(`${ex.name}`, 60, y);
            doc.fillColor(COLORS.grey)
              .text(`${ex.sets} x ${ex.reps} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 300, y);
            y += 20;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) {
      doc.addPage();
      y = 50;
    }

    y += 20;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.gold).lineWidth(1).stroke();
    y += 20;

    doc.fontSize(18).fillColor(COLORS.black)
      .text('NUTRITION PLAN', 50, y, { characterSpacing: 3 });
    y += 35;

    if (nutritionPlan) {
      if (nutritionPlan.calories) {
        doc.rect(50, y, 495, 40).fill('#F5F0E8');
        doc.fontSize(11).fillColor(COLORS.black)
          .text(`Daily Target: ${nutritionPlan.calories} kcal`, 60, y + 6);
        doc.fillColor(COLORS.grey)
          .text(`P: ${nutritionPlan.protein}g | C: ${nutritionPlan.carbs}g | F: ${nutritionPlan.fats}g`, 60, y + 22);
        y += 50;
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) {
            doc.addPage();
            y = 50;
          }
          doc.fontSize(11).fillColor(COLORS.gold)
            .text(meal.name.toUpperCase(), 60, y, { characterSpacing: 1 });
          y += 18;
          doc.fontSize(10).fillColor(COLORS.black)
            .text(meal.description, 60, y, { width: 480 });
          y += doc.heightOfString(meal.description, { width: 480 }) + 10;
        }
      }
    }

    // Notes
    if (notes) {
      if (y > 650) {
        doc.addPage();
        y = 50;
      }
      y += 20;
      doc.moveTo(50, y).lineTo(545, y).strokeColor(COLORS.gold).lineWidth(1).stroke();
      y += 20;
      doc.fontSize(18).fillColor(COLORS.black)
        .text('COACH NOTES', 50, y, { characterSpacing: 3 });
      y += 30;
      doc.fontSize(10).fillColor(COLORS.grey)
        .text(notes, 50, y, { width: 495 });
    }

    // Footer
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, 792, 595.28, 50).fill(COLORS.black);
      doc.fontSize(8).fillColor(COLORS.goldLight)
        .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, 800, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Sessions Pack'
  };
  return map[code] || code;
}

module.exports = { generateProgramPDF, formatProgram };
