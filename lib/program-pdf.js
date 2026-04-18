const PDFDocument = require('pdfkit');

const COLORS = {
  black: '#2C2C2C',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  lightGrey: '#E8E3DC',
  white: '#FFFFFF'
};

function generatePDF(client, weekNo, programData) {
  return new Promise(function (resolve, reject) {
    var doc = new PDFDocument({ size: 'A4', margin: 50 });
    var chunks = [];

    doc.on('data', function (chunk) { chunks.push(chunk); });
    doc.on('end', function () { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(COLORS.black);
    doc.fontSize(24).fill(COLORS.gold)
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 4 });
    doc.fontSize(10).fill(COLORS.goldLight)
      .text('WEEK ' + weekNo + ' PROGRAM', 50, 55, { characterSpacing: 2 });

    // Client info
    doc.fill(COLORS.black).fontSize(12)
      .text(client.name + ' | ' + client.program.toUpperCase(), 50, 100);
    doc.fontSize(9).fill(COLORS.grey)
      .text('Generated: ' + new Date().toLocaleDateString('en-IN'), 50, 118);

    doc.moveTo(50, 140).lineTo(545, 140).stroke(COLORS.lightGrey);

    var y = 155;

    // Workout Plan
    var workouts = programData.workout_plan || programData.workouts;
    if (workouts && workouts.days) {
      doc.fontSize(16).fill(COLORS.gold).text('WORKOUT PLAN', 50, y);
      y += 30;

      for (var di = 0; di < workouts.days.length; di++) {
        var day = workouts.days[di];
        if (y > 720) { doc.addPage(); y = 50; }

        doc.rect(50, y, 495, 22).fill(COLORS.black);
        doc.fontSize(10).fill(COLORS.gold)
          .text(day.day.toUpperCase() + ' \u2014 ' + (day.focus || '').toUpperCase(), 60, y + 6, { characterSpacing: 1 });
        y += 28;

        if (day.exercises) {
          doc.fontSize(8).fill(COLORS.grey);
          doc.text('EXERCISE', 60, y);
          doc.text('SETS', 300, y);
          doc.text('REPS', 360, y);
          doc.text('REST', 420, y);
          y += 15;

          for (var ei = 0; ei < day.exercises.length; ei++) {
            var ex = day.exercises[ei];
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(9).fill(COLORS.black);
            doc.text(ex.name || '', 60, y, { width: 230 });
            doc.text(String(ex.sets || ''), 300, y);
            doc.text(String(ex.reps || ''), 360, y);
            doc.text(String(ex.rest || ''), 420, y);
            if (ex.notes) {
              y += 14;
              doc.fontSize(7).fill(COLORS.grey).text(ex.notes, 70, y, { width: 400 });
            }
            y += 16;
          }
        }
        y += 10;
      }

      if (workouts.cardio) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill(COLORS.gold).text('CARDIO', 50, y);
        y += 16;
        var cardioLine = [workouts.cardio.type, workouts.cardio.frequency, workouts.cardio.duration]
          .filter(Boolean).join(' | ');
        doc.fontSize(9).fill(COLORS.black).text(cardioLine, 60, y);
        y += 24;
      }
    }

    // Nutrition Plan
    var nutrition = programData.nutrition_plan || programData.nutrition;
    if (nutrition) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.moveTo(50, y).lineTo(545, y).stroke(COLORS.lightGrey);
      y += 20;

      doc.fontSize(16).fill(COLORS.gold).text('NUTRITION PLAN', 50, y);
      y += 30;

      doc.rect(50, y, 495, 40).fill('#F5F0E8');
      doc.fontSize(9).fill(COLORS.black);
      var macros = [
        'CALORIES: ' + (nutrition.calories || '\u2014'),
        'PROTEIN: ' + (nutrition.protein_g || '\u2014') + 'g',
        'CARBS: ' + (nutrition.carbs_g || '\u2014') + 'g',
        'FATS: ' + (nutrition.fats_g || '\u2014') + 'g'
      ];
      for (var mi = 0; mi < macros.length; mi++) {
        doc.text(macros[mi], 60 + mi * 120, y + 14, { characterSpacing: 1 });
      }
      y += 55;

      if (nutrition.meals) {
        for (var mli = 0; mli < nutrition.meals.length; mli++) {
          var meal = nutrition.meals[mli];
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(COLORS.black).text(meal.meal || '', 60, y);
          y += 16;
          if (meal.options) {
            for (var oi = 0; oi < meal.options.length; oi++) {
              doc.fontSize(8).fill(COLORS.grey).text('\u2022 ' + meal.options[oi], 70, y, { width: 460 });
              y += 13;
            }
          }
          y += 8;
        }
      }

      if (nutrition.supplements && nutrition.supplements.length) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill(COLORS.gold).text('SUPPLEMENTS', 50, y);
        y += 16;
        for (var si = 0; si < nutrition.supplements.length; si++) {
          doc.fontSize(8).fill(COLORS.grey).text('\u2022 ' + nutrition.supplements[si], 60, y, { width: 460 });
          y += 13;
        }
      }
    }

    // Coach notes
    if (programData.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 10;
      doc.moveTo(50, y).lineTo(545, y).stroke(COLORS.lightGrey);
      y += 15;
      doc.fontSize(10).fill(COLORS.gold).text('COACH NOTES', 50, y);
      y += 18;
      doc.fontSize(9).fill(COLORS.black).text(programData.notes, 60, y, { width: 470 });
    }

    // Footer
    doc.fontSize(7).fill(COLORS.grey)
      .text('FitnessByMaddy \u2014 Confidential & Personalized',
        50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}

module.exports = { generatePDF };
