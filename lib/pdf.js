const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF'
};

function generateProgramPDF(client, weekNo, workout, nutrition, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.white).text(`Week ${weekNo} Program`, 50, 55, { characterSpacing: 1 });

    // Client info
    doc.fill(BRAND.black);
    doc.moveDown(2);
    doc.y = 110;
    doc.fontSize(11).fill(BRAND.grey).text(`Client: ${client.name}`, 50);
    doc.text(`Program: ${formatProgramName(client.program)}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    // Workout section
    doc.moveDown(1.5);
    doc.fontSize(18).fill(BRAND.gold).text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke(BRAND.gold);
    doc.moveDown(0.8);

    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill(BRAND.black).text(day.name, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(BRAND.grey)
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}${ex.rest ? `  (Rest: ${ex.rest})` : ''}`, 60);
          }
        }
        doc.moveDown(0.6);
      }
    }

    // Nutrition section
    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(18).fill(BRAND.gold).text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke(BRAND.gold);
    doc.moveDown(0.8);

    if (nutrition) {
      if (nutrition.calories) {
        doc.fontSize(11).fill(BRAND.black).text(`Daily Target: ${nutrition.calories} kcal`, 50);
      }
      if (nutrition.macros) {
        doc.fontSize(10).fill(BRAND.grey)
          .text(`Protein: ${nutrition.macros.protein}g  |  Carbs: ${nutrition.macros.carbs}g  |  Fat: ${nutrition.macros.fat}g`, 50);
      }
      doc.moveDown(0.5);
      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(12).fill(BRAND.black).text(meal.name, 50);
          doc.fontSize(10).fill(BRAND.grey).text(meal.description, 60);
          doc.moveDown(0.4);
        }
      }
    }

    // Notes
    if (notes) {
      if (doc.y > 680) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(18).fill(BRAND.gold).text('COACH NOTES', 50);
      doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke(BRAND.gold);
      doc.moveDown(0.5);
      doc.fontSize(10).fill(BRAND.grey).text(notes, 50, undefined, { width: 495 });
    }

    // Footer
    const footerY = 780;
    doc.fontSize(8).fill(BRAND.grey)
      .text('fitnessbymaddy.com  |  Confidential — for personal use only', 50, footerY, { align: 'center', width: 495 });

    doc.end();
  });
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const path = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error } = await supabase.storage
    .from('programs')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = supabase.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

function formatProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[code] || code;
}

module.exports = { generateProgramPDF, uploadPDF, formatProgramName };
