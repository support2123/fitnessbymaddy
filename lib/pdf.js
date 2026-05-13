const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#1a1a1a',
  gold: '#B8965A',
  goldLight: '#D4AF7A',
  white: '#FFFFFF',
  grey: '#6B6B6B',
  cream: '#FAF8F4'
};

async function generateProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.goldLight).text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.moveDown(3);
    doc.fontSize(10).fill(BRAND.grey).text(`Client: ${client.name || 'N/A'}`, 50);
    doc.text(`Program: ${formatProgram(client.program)}`, 50);
    doc.text(`Week: ${weekNo}`, 50);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50);

    // Workout Plan
    doc.moveDown(2);
    doc.rect(50, doc.y, 495.28, 30).fill(BRAND.black);
    doc.fontSize(14).fill(BRAND.gold).text('WORKOUT PLAN', 60, doc.y - 23, { characterSpacing: 2 });
    doc.moveDown(1.5);

    if (workoutPlan && typeof workoutPlan === 'object') {
      const days = workoutPlan.days || workoutPlan;
      if (Array.isArray(days)) {
        days.forEach(day => {
          doc.fontSize(12).fill(BRAND.black).text(day.name || day.day || 'Day', 50);
          doc.moveDown(0.3);
          const exercises = day.exercises || [];
          exercises.forEach(ex => {
            const line = `  ${ex.name || ex}  —  ${ex.sets || ''}x${ex.reps || ''}  ${ex.rest ? '| Rest: ' + ex.rest : ''}`;
            doc.fontSize(9).fill(BRAND.grey).text(line, 60);
          });
          doc.moveDown(0.8);
        });
      } else {
        doc.fontSize(10).fill(BRAND.grey).text(JSON.stringify(workoutPlan, null, 2), 50, doc.y, { width: 480 });
      }
    }

    // Nutrition Plan
    if (doc.y > 650) doc.addPage();
    doc.moveDown(2);
    doc.rect(50, doc.y, 495.28, 30).fill(BRAND.black);
    doc.fontSize(14).fill(BRAND.gold).text('NUTRITION PLAN', 60, doc.y - 23, { characterSpacing: 2 });
    doc.moveDown(1.5);

    if (nutritionPlan && typeof nutritionPlan === 'object') {
      if (nutritionPlan.calories) {
        doc.fontSize(11).fill(BRAND.black).text(`Daily Calories: ${nutritionPlan.calories} kcal`, 50);
      }
      if (nutritionPlan.macros) {
        const m = nutritionPlan.macros;
        doc.fontSize(10).fill(BRAND.grey).text(`Protein: ${m.protein || '-'}g  |  Carbs: ${m.carbs || '-'}g  |  Fats: ${m.fats || '-'}g`, 50);
      }
      doc.moveDown(0.8);
      const meals = nutritionPlan.meals || [];
      meals.forEach(meal => {
        doc.fontSize(11).fill(BRAND.black).text(meal.name || meal.time || 'Meal', 50);
        doc.fontSize(9).fill(BRAND.grey).text(meal.description || meal.items || '', 60);
        doc.moveDown(0.5);
      });
    }

    // Notes
    if (notes) {
      doc.moveDown(1.5);
      doc.fontSize(11).fill(BRAND.black).text('NOTES', 50);
      doc.moveDown(0.3);
      doc.fontSize(9).fill(BRAND.grey).text(notes, 50, doc.y, { width: 480 });
    }

    // Footer
    const pageHeight = 841.89;
    doc.rect(0, pageHeight - 40, 595.28, 40).fill(BRAND.black);
    doc.fontSize(8).fill(BRAND.goldLight).text(
      'fitnessbymaddy.com  |  @fitnessbymaddy_',
      0, pageHeight - 28, { align: 'center', width: 595.28 }
    );

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
  return map[program] || program;
}

module.exports = { generateProgramPDF, uploadPDF, formatProgram };
