const PdfPrinter = require('pdfmake');

const fonts = {
  Roboto: {
    normal: require.resolve('pdfmake/build/vfs_fonts.js') ? 'Helvetica' : 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPdf(client, weekNo, workoutPlan, nutritionPlan, notes) {
  const printer = new PdfPrinter({
    Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' }
  });

  const workoutRows = [];
  if (workoutPlan && workoutPlan.days) {
    for (const day of workoutPlan.days) {
      workoutRows.push([
        { text: day.day, bold: true, color: BRAND.gold },
        { text: day.focus || '', color: BRAND.black },
        { text: (day.exercises || []).map(e => `${e.name}: ${e.sets}x${e.reps}${e.rest ? ` (${e.rest})` : ''}`).join('\n'), color: BRAND.grey, fontSize: 9 }
      ]);
    }
  }

  const nutritionContent = [];
  if (nutritionPlan) {
    if (nutritionPlan.calories) {
      nutritionContent.push({ text: `Daily Target: ${nutritionPlan.calories} kcal`, fontSize: 12, bold: true, margin: [0, 0, 0, 8] });
    }
    if (nutritionPlan.macros) {
      nutritionContent.push({
        text: `Protein: ${nutritionPlan.macros.protein}g | Carbs: ${nutritionPlan.macros.carbs}g | Fat: ${nutritionPlan.macros.fat}g`,
        fontSize: 10, color: BRAND.grey, margin: [0, 0, 0, 12]
      });
    }
    if (nutritionPlan.meals) {
      for (const meal of nutritionPlan.meals) {
        nutritionContent.push({ text: meal.name, bold: true, fontSize: 10, margin: [0, 8, 0, 4], color: BRAND.gold });
        nutritionContent.push({ text: meal.description || meal.items?.join(', ') || '', fontSize: 9, color: BRAND.grey });
      }
    }
  }

  const docDefinition = {
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: BRAND.black },
    pageMargins: [40, 60, 40, 60],
    background: function () {
      return { canvas: [{ type: 'rect', x: 0, y: 0, w: 595, h: 842, color: BRAND.cream }] };
    },
    content: [
      { canvas: [{ type: 'rect', x: -40, y: -60, w: 595, h: 120, color: BRAND.black }] },
      { text: 'FITNESS BY MADDY', fontSize: 10, color: BRAND.gold, letterSpacing: 4, margin: [0, -80, 0, 4] },
      { text: `WEEK ${weekNo} PROGRAM`, fontSize: 28, bold: true, color: BRAND.white, margin: [0, 0, 0, 8] },
      { text: `Prepared for ${client.name || 'Client'}`, fontSize: 11, color: BRAND.goldLight, margin: [0, 0, 0, 50] },

      { text: 'WORKOUT PLAN', fontSize: 14, bold: true, color: BRAND.black, margin: [0, 20, 0, 12] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: BRAND.gold }] },
      workoutRows.length > 0 ? {
        table: {
          headerRows: 1,
          widths: [60, 100, '*'],
          body: [
            [
              { text: 'DAY', bold: true, fontSize: 9, color: BRAND.gold },
              { text: 'FOCUS', bold: true, fontSize: 9, color: BRAND.gold },
              { text: 'EXERCISES', bold: true, fontSize: 9, color: BRAND.gold }
            ],
            ...workoutRows
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => '#E8E3DC',
          paddingTop: () => 8,
          paddingBottom: () => 8
        },
        margin: [0, 12, 0, 20]
      } : { text: 'Workout plan details to follow.', italics: true, color: BRAND.grey, margin: [0, 12, 0, 20] },

      { text: 'NUTRITION PLAN', fontSize: 14, bold: true, color: BRAND.black, margin: [0, 12, 0, 12] },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: BRAND.gold }] },
      ...nutritionContent.length > 0 ? nutritionContent : [{ text: 'Nutrition guidelines to follow.', italics: true, color: BRAND.grey, margin: [0, 12, 0, 0] }],

      notes ? { text: '\nCOACH NOTES', fontSize: 14, bold: true, color: BRAND.black, margin: [0, 24, 0, 12] } : {},
      notes ? { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: BRAND.gold }] } : {},
      notes ? { text: notes, fontSize: 10, color: BRAND.grey, margin: [0, 12, 0, 0], lineHeight: 1.6 } : {}
    ],
    footer: function (currentPage, pageCount) {
      return {
        columns: [
          { text: 'FITNESS BY MADDY', fontSize: 8, color: BRAND.gold, alignment: 'left', margin: [40, 0] },
          { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: BRAND.grey, alignment: 'right', margin: [0, 0, 40, 0] }
        ]
      };
    }
  };

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition);
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { generateProgramPdf };
