// Branded weekly-program PDF. Black/gold palette. Simple vanilla layout.
// Uses pdf-lib — no external fonts shipped; standard Helvetica-Bold stands in for Bebas Neue.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const GOLD = rgb(184/255, 150/255, 90/255);
const CHARCOAL = rgb(44/255, 44/255, 44/255);
const CREAM = rgb(250/255, 248/255, 244/255);

async function renderProgramPdf({ client, plan }) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const pageW = 612;  // letter
  const pageH = 792;
  const margin = 48;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  // Header bar
  page.drawRectangle({ x: 0, y: pageH - 60, width: pageW, height: 60, color: CHARCOAL });
  page.drawText('FITNESS BY MADDY', {
    x: margin, y: pageH - 38, size: 14, font: bold, color: CREAM,
  });
  page.drawText(`Week ${plan.week_no || ''}`, {
    x: pageW - margin - 80, y: pageH - 38, size: 14, font: bold, color: GOLD,
  });

  y = pageH - 90;
  page.drawText(`${client.name || 'Client'} · ${labelFor(client.program)}`, {
    x: margin, y, size: 12, font: reg, color: CHARCOAL,
  });
  y -= 28;
  page.drawText(plan.focus || 'Weekly Focus', {
    x: margin, y, size: 22, font: bold, color: CHARCOAL,
  });
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: GOLD });
  y -= 24;

  // Workout section
  page = ensureRoom(pdf, page, y, 100, pageW, pageH, margin);
  page.drawText('WORKOUT PLAN', { x: margin, y, size: 11, font: bold, color: GOLD });
  y -= 16;
  page.drawText(`Split: ${plan.workout_plan?.split || '-'}`, {
    x: margin, y, size: 10, font: reg, color: CHARCOAL,
  });
  y -= 18;

  for (const day of (plan.workout_plan?.days || [])) {
    ({ page, y } = ensureRoomObj(pdf, page, y, 80, pageW, pageH, margin));
    page.drawText(`Day ${day.day} — ${day.title || ''} (${day.duration_min || 45} min)`, {
      x: margin, y, size: 12, font: bold, color: CHARCOAL,
    });
    y -= 14;
    if (day.warmup?.length) {
      page.drawText('Warmup: ' + day.warmup.join(', '), {
        x: margin + 8, y, size: 9, font: ital, color: CHARCOAL, maxWidth: pageW - margin * 2 - 16,
      });
      y -= 12;
    }
    for (const ex of (day.main || [])) {
      ({ page, y } = ensureRoomObj(pdf, page, y, 14, pageW, pageH, margin));
      const line = `• ${ex.exercise}  —  ${ex.sets}×${ex.reps}  ·  rest ${ex.rest_sec}s`;
      page.drawText(line, { x: margin + 8, y, size: 10, font: reg, color: CHARCOAL });
      y -= 12;
      if (ex.notes) {
        ({ page, y } = ensureRoomObj(pdf, page, y, 12, pageW, pageH, margin));
        page.drawText(`  ${ex.notes}`, {
          x: margin + 16, y, size: 8, font: ital, color: CHARCOAL,
        });
        y -= 10;
      }
    }
    if (day.finisher) {
      page.drawText('Finisher: ' + day.finisher, { x: margin + 8, y, size: 9, font: ital, color: CHARCOAL });
      y -= 14;
    }
    y -= 6;
  }

  // Nutrition section
  ({ page, y } = ensureRoomObj(pdf, page, y, 120, pageW, pageH, margin));
  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: GOLD });
  y -= 16;
  page.drawText('NUTRITION PLAN', { x: margin, y, size: 11, font: bold, color: GOLD });
  y -= 16;
  const np = plan.nutrition_plan || {};
  page.drawText(`Target: ${np.kcal_target || '-'} kcal · P ${np.protein_g || '-'}g · C ${np.carbs_g || '-'}g · F ${np.fat_g || '-'}g`, {
    x: margin, y, size: 10, font: bold, color: CHARCOAL,
  });
  y -= 16;
  for (const meal of (np.meals || [])) {
    ({ page, y } = ensureRoomObj(pdf, page, y, 30, pageW, pageH, margin));
    page.drawText(meal.name || '', { x: margin, y, size: 10, font: bold, color: CHARCOAL });
    y -= 12;
    const items = (meal.items || []).join(' · ');
    wrapText(page, items, margin + 8, y, pageW - margin * 2 - 16, 9, reg, CHARCOAL, (used) => { y -= used; });
    y -= 6;
  }

  if (plan.coach_notes) {
    ({ page, y } = ensureRoomObj(pdf, page, y, 60, pageW, pageH, margin));
    y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: GOLD });
    y -= 16;
    page.drawText("MADDY'S NOTES", { x: margin, y, size: 11, font: bold, color: GOLD });
    y -= 14;
    wrapText(page, plan.coach_notes, margin, y, pageW - margin * 2, 10, ital, CHARCOAL, (used) => { y -= used; });
  }

  // Footer on every page
  const allPages = pdf.getPages();
  for (let i = 0; i < allPages.length; i++) {
    const p = allPages[i];
    p.drawText(`fitnessbymaddy.com · Week ${plan.week_no || ''} · Page ${i + 1}/${allPages.length}`, {
      x: margin, y: 20, size: 8, font: reg, color: CHARCOAL,
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function labelFor(program) {
  return {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Coaching',
  }[program] || program;
}

function ensureRoom(pdf, page, y, need, pageW, pageH, margin) {
  if (y - need < margin) return pdf.addPage([pageW, pageH]);
  return page;
}
function ensureRoomObj(pdf, page, y, need, pageW, pageH, margin) {
  if (y - need < margin) {
    const next = pdf.addPage([pageW, pageH]);
    return { page: next, y: pageH - margin };
  }
  return { page, y };
}

function wrapText(page, text, x, y, maxWidth, size, font, color, onUse) {
  if (!text) return;
  const words = String(text).split(/\s+/);
  let line = '';
  let usedHeight = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth) {
      page.drawText(line, { x, y: y - usedHeight, size, font, color });
      usedHeight += size + 2;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) {
    page.drawText(line, { x, y: y - usedHeight, size, font, color });
    usedHeight += size + 2;
  }
  onUse?.(usedHeight);
}

module.exports = { renderProgramPdf };
