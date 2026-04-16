// Branded PDF renderer for weekly programs.
// Uses PDFKit (pure-JS, works in serverless). Colors + fonts mirror
// the website palette: charcoal background, gold accents.

import PDFDocument from 'pdfkit';

const GOLD     = '#B8965A';
const CHARCOAL = '#2C2C2C';
const CREAM    = '#FAF8F4';
const MID_GREY = '#6B6B6B';

// Brand note: the website uses Cormorant Garamond for headers and
// DM Sans for body. PDFKit only ships with Helvetica-family fonts,
// so we use Helvetica-Bold as a neutral stand-in and keep the
// visual hierarchy via size + color + letter-spacing (characterSpacing).

export async function renderProgramPDF({ client, weekNo, plan }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
      Title: `Week ${weekNo} Program — ${client.name || 'Client'}`,
      Author: 'Fitness by Maddy',
    }});
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ─── Cover block ────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 140).fill(CHARCOAL);
    doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 48, 40, { characterSpacing: 4 });
    doc.fillColor(CREAM).fontSize(28).font('Helvetica')
      .text(`Week ${weekNo} Program`, 48, 62);
    doc.fillColor(CREAM).fontSize(11).font('Helvetica')
      .text(`${client.name || 'Client'} · ${programLabel(client.program)}`, 48, 102);

    doc.moveDown(2);
    doc.y = 170;

    // ─── Focus ──────────────────────────────────────────────
    sectionTitle(doc, 'THIS WEEK\'S FOCUS');
    doc.fillColor(CHARCOAL).fontSize(13).font('Helvetica')
      .text(plan.week_focus || '—', { width: 500 });
    doc.moveDown(1);

    // ─── Workout ────────────────────────────────────────────
    sectionTitle(doc, 'TRAINING');
    const days = plan.workout_plan?.days || [];
    for (const d of days) {
      ensureSpace(doc, 100);
      doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold')
        .text(`DAY ${d.day} — ${(d.title || '').toUpperCase()}`, { characterSpacing: 1.5 });
      doc.moveDown(0.3);
      for (const b of (d.blocks || [])) {
        ensureSpace(doc, 40);
        doc.fillColor(CHARCOAL).fontSize(11).font('Helvetica-Bold').text(b.name || '');
        doc.fillColor(MID_GREY).fontSize(10).font('Helvetica')
          .text(`${b.sets || '-'} × ${b.reps || '-'}  ·  rest ${b.rest_sec || '-'}s${b.notes ? '  ·  ' + b.notes : ''}`);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.6);
    }

    // ─── Nutrition ──────────────────────────────────────────
    ensureSpace(doc, 200);
    sectionTitle(doc, 'NUTRITION');
    const n = plan.nutrition_plan || {};
    doc.fillColor(CHARCOAL).fontSize(11).font('Helvetica')
      .text(`Target: ${n.target_kcal ?? '-'} kcal  ·  P ${n.protein_g ?? '-'}g · C ${n.carbs_g ?? '-'}g · F ${n.fat_g ?? '-'}g`);
    doc.moveDown(0.5);
    for (const meal of (n.meals || [])) {
      ensureSpace(doc, 60);
      doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
        .text((meal.name || '').toUpperCase(), { characterSpacing: 1.5 });
      for (const opt of (meal.options || [])) {
        doc.fillColor(MID_GREY).fontSize(10).font('Helvetica').text('•  ' + opt, { indent: 8 });
      }
      doc.moveDown(0.3);
    }
    if (n.notes) {
      doc.moveDown(0.3);
      doc.fillColor(MID_GREY).fontSize(10).font('Helvetica-Oblique').text(n.notes);
    }

    // ─── Coach note ─────────────────────────────────────────
    if (plan.coach_note) {
      ensureSpace(doc, 100);
      doc.moveDown(1);
      doc.rect(48, doc.y, doc.page.width - 96, 1).fill(GOLD);
      doc.moveDown(0.5);
      doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
        .text('A NOTE FROM MADDY', { characterSpacing: 2 });
      doc.moveDown(0.3);
      doc.fillColor(CHARCOAL).fontSize(11).font('Helvetica-Oblique')
        .text(plan.coach_note, { width: 500 });
    }

    // ─── Footer ─────────────────────────────────────────────
    doc.fontSize(8).fillColor(MID_GREY).font('Helvetica')
      .text('fitnessbymaddy.com  ·  support@fitnessbymaddy.com',
        48, doc.page.height - 36, { align: 'center', width: doc.page.width - 96 });

    doc.end();
  });
}

function sectionTitle(doc, label) {
  doc.moveDown(0.5);
  doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
    .text(label, { characterSpacing: 3 });
  doc.moveDown(0.3);
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - 48) doc.addPage();
}

function programLabel(p) {
  return ({
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Edition',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  })[p] || p;
}
