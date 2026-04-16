// Branded weekly-program PDF. Uses pdf-lib (pure JS, serverless-friendly).
// Colors mirror the site: charcoal background, gold accents, cream body.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const CHARCOAL = rgb(0.173, 0.173, 0.173); // #2C2C2C
const GOLD     = rgb(0.721, 0.588, 0.353); // #B8965A
const CREAM    = rgb(0.98,  0.972, 0.956); // #FAF8F4
const MID      = rgb(0.419, 0.419, 0.419); // #6B6B6B

export async function buildProgramPdf({ clientName, weekNo, plan }) {
  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold); // stands in for Cormorant
  const body  = await pdf.embedFont(StandardFonts.Helvetica);      // stands in for DM Sans
  const bodyB = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // Top band
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: CHARCOAL });
  page.drawText('FITNESS BY MADDY', {
    x: 40, y: height - 55, size: 14, font: bodyB, color: CREAM,
    characterSpacing: 3
  });
  page.drawText(`Week ${weekNo} Program`, {
    x: 40, y: height - 95, size: 28, font: serif, color: rgb(0.835, 0.686, 0.478) // gold-light
  });
  page.drawText(clientName || 'Athlete', {
    x: width - 40 - body.widthOfTextAtSize(clientName || 'Athlete', 11),
    y: height - 55, size: 11, font: body, color: CREAM
  });

  let y = height - 160;
  const H1 = (t) => {
    page.drawText(t.toUpperCase(), { x: 40, y, size: 11, font: bodyB, color: GOLD, characterSpacing: 3 });
    y -= 14;
    page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: GOLD });
    y -= 18;
  };
  const P = (t, opts = {}) => {
    const size = opts.size || 10;
    const font = opts.bold ? bodyB : body;
    const color = opts.color || CHARCOAL;
    const maxW = width - 80;
    const words = String(t || '').split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW) {
        page.drawText(line, { x: 40, y, size, font, color });
        y -= size + 4;
        line = w;
      } else line = test;
      if (y < 60) return; // soft clip
    }
    if (line) { page.drawText(line, { x: 40, y, size, font, color }); y -= size + 4; }
  };

  H1('Week Focus');
  P(plan.week_focus || '—');
  y -= 8;

  H1('Workout');
  P(`${plan.workout?.days_per_week || '?'} days / week`, { bold: true, color: MID });
  for (const s of (plan.workout?.sessions || [])) {
    y -= 6;
    P(`${s.day} · ${s.name}`, { bold: true, size: 12 });
    for (const b of (s.blocks || [])) {
      P(`• ${b.exercise} — ${b.sets}×${b.reps}  (rest ${b.rest_s}s)  ${b.cue ? '— ' + b.cue : ''}`);
    }
    if (y < 120) { y = height - 60; pdf.addPage([595, 842]); }
  }

  y -= 10;
  H1('Nutrition');
  const n = plan.nutrition || {};
  P(`${n.kcal_target || '?'} kcal  ·  P ${n.protein_g || '?'}g  ·  C ${n.carb_g || '?'}g  ·  F ${n.fat_g || '?'}g`, { bold: true });
  for (const m of (n.meal_pattern || [])) P(`• ${m}`);
  if (n.notes) { y -= 6; P(n.notes, { color: MID }); }

  y -= 10;
  H1('Notes');
  P(plan.weekly_notes || '—');

  // Footer
  page.drawLine({ start: { x: 40, y: 40 }, end: { x: width - 40, y: 40 }, thickness: 0.5, color: rgb(0.91, 0.89, 0.86) });
  page.drawText('fitnessbymaddy.com  ·  support@fitnessbymaddy.com', {
    x: 40, y: 26, size: 8, font: body, color: MID
  });

  const bytes = await pdf.save();
  return bytes;
}
