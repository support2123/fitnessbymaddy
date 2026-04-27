const PDFDocument = require('pdfkit');
const { supabase } = require('./supabase');

const BRAND = {
  black: '#1A1A1A',
  gold: '#B8965A',
  cream: '#FAF8F4',
  grey: '#6B6B6B',
  white: '#FFFFFF',
};

function createProgramPDF(client, weekNo, workoutPlan, nutritionPlan, notes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header bar
    doc.rect(0, 0, 595, 80).fill(BRAND.black);
    doc.fontSize(28).fill(BRAND.gold).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 25, { characterSpacing: 3 });
    doc.fontSize(10).fill(BRAND.white).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 55, { characterSpacing: 2 });

    // Client info
    doc.fill(BRAND.black).fontSize(12).font('Helvetica-Bold')
      .text(client.name || 'Client', 50, 100);
    doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
      .text(`Program: ${formatProgramName(client.program)} | Week ${weekNo}`, 50, 118);

    doc.moveTo(50, 140).lineTo(545, 140).strokeColor(BRAND.gold).lineWidth(1).stroke();

    let y = 160;

    // Workout section
    y = renderSection(doc, 'WORKOUT PLAN', workoutPlan, y);

    if (y > 680) {
      doc.addPage();
      y = 50;
    }

    // Nutrition section
    y = renderSection(doc, 'NUTRITION PLAN', nutritionPlan, y);

    // Notes
    if (notes) {
      if (y > 680) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(14).fill(BRAND.gold).font('Helvetica-Bold')
        .text('COACH NOTES', 50, y);
      y += 25;
      doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
        .text(notes, 50, y, { width: 495, lineGap: 4 });
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(BRAND.grey).font('Helvetica')
        .text('fitnessbymaddy.com | Confidential', 50, 780, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

function renderSection(doc, title, plan, startY) {
  let y = startY;
  doc.fontSize(14).fill(BRAND.gold).font('Helvetica-Bold')
    .text(title, 50, y, { characterSpacing: 2 });
  y += 28;

  if (!plan) {
    doc.fontSize(10).fill(BRAND.grey).font('Helvetica')
      .text('To be provided by coach.', 50, y);
    return y + 30;
  }

  if (typeof plan === 'string') {
    doc.fontSize(10).fill(BRAND.black).font('Helvetica')
      .text(plan, 50, y, { width: 495, lineGap: 4 });
    return y + doc.heightOfString(plan, { width: 495, lineGap: 4 }) + 20;
  }

  if (Array.isArray(plan)) {
    for (const day of plan) {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(11).fill(BRAND.black).font('Helvetica-Bold')
        .text(day.day || day.title || '', 50, y);
      y += 18;

      const exercises = day.exercises || day.items || day.meals || [];
      for (const item of exercises) {
        if (y > 740) {
          doc.addPage();
          y = 50;
        }
        const line = typeof item === 'string' ? item : formatExercise(item);
        doc.fontSize(9).fill(BRAND.grey).font('Helvetica')
          .text(`  ${line}`, 60, y, { width: 475 });
        y += 14;
      }
      y += 10;
    }
  }

  return y + 10;
}

function formatExercise(item) {
  if (item.name && item.sets && item.reps) {
    return `${item.name} — ${item.sets}x${item.reps}${item.rest ? ` (Rest: ${item.rest})` : ''}`;
  }
  if (item.name && item.description) {
    return `${item.name}: ${item.description}`;
  }
  return item.name || item.description || JSON.stringify(item);
}

function formatProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return names[program] || program;
}

async function uploadPDF(clientId, weekNo, pdfBuffer) {
  const path = `clients/${clientId}/week_${weekNo}.pdf`;
  const { error } = await supabase.storage
    .from('programs')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw new Error(`PDF upload failed: ${error.message}`);

  const { data } = supabase.storage.from('programs').getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { createProgramPDF, uploadPDF, formatProgramName };
