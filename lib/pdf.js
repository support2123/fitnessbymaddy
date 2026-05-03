const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  grey: '#6B6B6B',
  cream: '#FAF8F4',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(COLORS.black);
    doc.fontSize(28).font('Helvetica-Bold').fillColor(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 25, { width: 495, align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.goldLight)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { width: 495, align: 'left' });

    // Client info bar
    doc.rect(0, 80, 595.28, 40).fill('#F5F0E8');
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.grey)
      .text(`Client: ${client.name}  |  Program: ${formatProgram(client.program)}  |  Generated: ${new Date().toLocaleDateString('en-GB')}`, 50, 93, { width: 495 });

    let y = 140;

    // Notes section
    if (notes) {
      y = sectionHeader(doc, 'COACH NOTES', y);
      doc.fontSize(10).font('Helvetica').fillColor(COLORS.grey)
        .text(notes, 50, y, { width: 495, lineGap: 4 });
      y = doc.y + 20;
    }

    // Workout plan
    if (workout && workout.days) {
      y = sectionHeader(doc, 'WORKOUT PLAN', y);
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.black)
          .text(day.name.toUpperCase(), 50, y);
        y = doc.y + 4;
        if (day.focus) {
          doc.fontSize(8).font('Helvetica').fillColor(COLORS.gold)
            .text(day.focus, 50, y);
          y = doc.y + 6;
        }
        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(9).font('Helvetica').fillColor(COLORS.grey)
              .text(`  ${ex.name}`, 50, y, { continued: true })
              .text(`  ${ex.sets}x${ex.reps} ${ex.rest ? '| Rest ' + ex.rest : ''}`, { align: 'right', width: 495 });
            y = doc.y + 3;
            if (ex.notes) {
              doc.fontSize(8).fillColor('#999')
                .text(`    ${ex.notes}`, 60, y);
              y = doc.y + 2;
            }
          }
        }
        y += 10;
      }
    }

    // Nutrition plan
    if (nutrition) {
      if (y > 600) { doc.addPage(); y = 50; }
      y = sectionHeader(doc, 'NUTRITION PLAN', y);

      if (nutrition.calories || nutrition.protein) {
        doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.black)
          .text('Daily Targets', 50, y);
        y = doc.y + 4;
        const targets = [
          nutrition.calories ? `Calories: ${nutrition.calories} kcal` : null,
          nutrition.protein ? `Protein: ${nutrition.protein}g` : null,
          nutrition.carbs ? `Carbs: ${nutrition.carbs}g` : null,
          nutrition.fats ? `Fats: ${nutrition.fats}g` : null
        ].filter(Boolean).join('  |  ');
        doc.fontSize(9).font('Helvetica').fillColor(COLORS.grey).text(targets, 50, y);
        y = doc.y + 12;
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.black)
            .text(meal.name, 50, y);
          y = doc.y + 3;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(9).font('Helvetica').fillColor(COLORS.grey)
                .text(`  - ${item}`, 60, y);
              y = doc.y + 2;
            }
          }
          if (meal.notes) {
            doc.fontSize(8).fillColor('#999').text(`  ${meal.notes}`, 60, y);
            y = doc.y + 2;
          }
          y += 8;
        }
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.rect(0, 802, 595.28, 40).fill(COLORS.black);
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.goldLight)
        .text('CONFIDENTIAL - Prepared exclusively for ' + client.name + ' by Fitness by Maddy', 50, 812, { width: 495, align: 'center' });
    }

    doc.end();
  });
}

function sectionHeader(doc, title, y) {
  doc.rect(50, y, 495, 1).fill(COLORS.gold);
  y += 8;
  doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.gold).text(title, 50, y);
  return doc.y + 10;
}

function formatProgram(program) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[program] || program || 'Custom';
}

module.exports = { generateProgramPDF, formatProgram };
