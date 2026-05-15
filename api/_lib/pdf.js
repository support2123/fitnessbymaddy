const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#1a1a1a',
  gold: '#B8965A',
  darkGold: '#8B6914',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(COLORS.black);
    doc.fontSize(10).fill(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 20, { characterSpacing: 4 });
    doc.fontSize(22).fill(COLORS.white)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 42, { characterSpacing: 2 });

    // Client info
    doc.rect(0, 80, 595, 40).fill(COLORS.gold);
    doc.fontSize(10).fill(COLORS.white)
      .text(`CLIENT: ${(client.name || 'Client').toUpperCase()}`, 50, 92, { characterSpacing: 1 });
    doc.text(`PROGRAM: ${(client.program || '12wk').toUpperCase().replace('_', ' ')}`, 300, 92, { characterSpacing: 1 });

    let y = 140;

    // Notes section
    if (notes) {
      doc.fontSize(8).fill(COLORS.gold).text('COACH NOTES', 50, y, { characterSpacing: 3 });
      y += 16;
      doc.fontSize(10).fill(COLORS.grey).text(notes, 50, y, { width: 495, lineGap: 4 });
      y = doc.y + 20;
    }

    // Workout plan
    doc.fontSize(14).fill(COLORS.black)
      .text('WORKOUT PLAN', 50, y, { characterSpacing: 3 });
    y += 6;
    doc.rect(50, y + 16, 100, 2).fill(COLORS.gold);
    y += 30;

    if (workoutPlan && workoutPlan.days) {
      for (const day of workoutPlan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 24).fill(COLORS.black);
        doc.fontSize(9).fill(COLORS.gold)
          .text((day.name || 'Day').toUpperCase(), 60, y + 7, { characterSpacing: 2 });
        if (day.focus) {
          doc.fill(COLORS.lightGrey)
            .text(day.focus.toUpperCase(), 200, y + 7, { characterSpacing: 1 });
        }
        y += 32;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }

            doc.fontSize(10).fill(COLORS.black)
              .text(ex.name || '', 60, y);
            doc.fontSize(9).fill(COLORS.grey)
              .text(`${ex.sets || ''}x${ex.reps || ''} ${ex.rest ? '| Rest: ' + ex.rest : ''}`, 60, y + 14);
            if (ex.notes) {
              doc.fontSize(8).fill(COLORS.gold).text(ex.notes, 60, y + 28);
              y += 12;
            }
            y += 30;
          }
        }
        y += 8;
      }
    } else if (workoutPlan && workoutPlan.summary) {
      doc.fontSize(10).fill(COLORS.grey)
        .text(workoutPlan.summary, 50, y, { width: 495, lineGap: 4 });
      y = doc.y + 20;
    }

    // Nutrition plan
    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(14).fill(COLORS.black)
      .text('NUTRITION PLAN', 50, y, { characterSpacing: 3 });
    y += 6;
    doc.rect(50, y + 16, 100, 2).fill(COLORS.gold);
    y += 30;

    if (nutritionPlan) {
      if (nutritionPlan.calories || nutritionPlan.protein) {
        doc.rect(50, y, 495, 60).fill('#F5F0E8');
        doc.fontSize(9).fill(COLORS.gold).text('DAILY TARGETS', 60, y + 8, { characterSpacing: 2 });
        const macros = [];
        if (nutritionPlan.calories) macros.push(`Calories: ${nutritionPlan.calories}`);
        if (nutritionPlan.protein) macros.push(`Protein: ${nutritionPlan.protein}g`);
        if (nutritionPlan.carbs) macros.push(`Carbs: ${nutritionPlan.carbs}g`);
        if (nutritionPlan.fat) macros.push(`Fat: ${nutritionPlan.fat}g`);
        doc.fontSize(11).fill(COLORS.black).text(macros.join('  |  '), 60, y + 26);
        if (nutritionPlan.water) {
          doc.fontSize(9).fill(COLORS.grey).text(`Water: ${nutritionPlan.water}`, 60, y + 44);
        }
        y += 72;
      }

      if (nutritionPlan.meals) {
        for (const meal of nutritionPlan.meals) {
          if (y > 720) { doc.addPage(); y = 50; }

          doc.fontSize(10).fill(COLORS.black)
            .text((meal.name || 'Meal').toUpperCase(), 60, y, { characterSpacing: 1 });
          y += 16;
          if (meal.items) {
            for (const item of meal.items) {
              doc.fontSize(9).fill(COLORS.grey).text(`  -  ${item}`, 60, y);
              y += 14;
            }
          }
          if (meal.notes) {
            doc.fontSize(8).fill(COLORS.gold).text(meal.notes, 70, y);
            y += 14;
          }
          y += 8;
        }
      } else if (nutritionPlan.summary) {
        doc.fontSize(10).fill(COLORS.grey)
          .text(nutritionPlan.summary, 50, y, { width: 495, lineGap: 4 });
        y = doc.y + 20;
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.rect(0, 802, 595, 40).fill(COLORS.black);
      doc.fontSize(7).fill(COLORS.gold)
        .text('FITNESS BY MADDY  |  fitnessbymaddy.com  |  @fitnessbymaddy_', 50, 812, {
          characterSpacing: 1, width: 495, align: 'center'
        });
    }

    doc.end();
  });
}

module.exports = { generateProgramPDF };
