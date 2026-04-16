import PDFDocument from 'pdfkit';

// Brand colours (match css/style.css)
const CHARCOAL = '#2C2C2C';
const GOLD = '#B8965A';
const GOLD_LIGHT = '#D4AF7A';
const CREAM = '#FAF8F4';
const MID_GREY = '#6B6B6B';

export async function renderProgramPdf({ client, weekNo, plan }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
      Title: `Week ${weekNo} — ${client.name || 'Client'}`,
      Author: 'Fitness by Maddy',
    }});
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header band ─────────────────────────────────
    doc.rect(0, 0, doc.page.width, 90).fill(CHARCOAL);
    doc.fillColor(CREAM)
       .font('Helvetica-Bold').fontSize(22)
       .text('FITNESS BY MADDY', 48, 32, { characterSpacing: 3 });
    doc.fillColor(GOLD_LIGHT).font('Helvetica').fontSize(11)
       .text(`Week ${weekNo} · ${client.name || 'Client'}`, 48, 60, { characterSpacing: 1.5 });
    doc.moveDown(3);
    doc.fillColor(CHARCOAL);

    // ── Summary ─────────────────────────────────────
    if (plan.summary) {
      sectionHeader(doc, 'This Week');
      doc.font('Helvetica').fontSize(11).fillColor(MID_GREY).text(plan.summary, { lineGap: 2 });
      doc.moveDown(1);
    }

    // ── Workout ─────────────────────────────────────
    sectionHeader(doc, 'Training');
    const days = plan.workout_plan?.days || [];
    days.forEach((d) => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(CHARCOAL)
         .text(`${d.day} — ${d.focus || ''}`);
      (d.blocks || []).forEach((b) => {
        const reps = b.reps != null ? `${b.reps}` : '';
        const sets = b.sets != null ? `${b.sets} × ` : '';
        const rest = b.rest_sec ? ` · rest ${b.rest_sec}s` : '';
        doc.font('Helvetica').fontSize(10).fillColor(MID_GREY)
           .text(`  • ${b.name}  —  ${sets}${reps}${rest}`);
        if (b.notes) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888')
             .text(`     ${b.notes}`);
        }
      });
      doc.moveDown(0.5);
    });
    if (plan.workout_plan?.cardio) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(CHARCOAL).text('Cardio');
      doc.font('Helvetica').fontSize(10).fillColor(MID_GREY).text(plan.workout_plan.cardio);
      doc.moveDown(0.5);
    }

    // ── Nutrition ───────────────────────────────────
    sectionHeader(doc, 'Nutrition');
    const np = plan.nutrition_plan || {};
    doc.font('Helvetica').fontSize(11).fillColor(CHARCOAL);
    if (np.calorie_target) doc.text(`Calories: ${np.calorie_target} kcal/day`);
    if (np.protein_g)      doc.text(`Protein: ${np.protein_g} g  ·  Carbs: ${np.carbs_g} g  ·  Fat: ${np.fat_g} g`);
    if (np.hydration_l)    doc.text(`Hydration: ${np.hydration_l} L water/day`);
    doc.moveDown(0.4);
    (np.meal_template || []).forEach((m) => {
      doc.font('Helvetica').fontSize(10).fillColor(MID_GREY).text(`  • ${m}`);
    });
    if ((np.supplements || []).length) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(CHARCOAL).text('Supplements');
      np.supplements.forEach((s) => {
        doc.font('Helvetica').fontSize(10).fillColor(MID_GREY).text(`  • ${s}`);
      });
    }

    // ── Coach notes ─────────────────────────────────
    if (plan.coach_notes) {
      doc.moveDown(1);
      sectionHeader(doc, 'From Maddy');
      doc.font('Helvetica-Oblique').fontSize(11).fillColor(CHARCOAL).text(plan.coach_notes, { lineGap: 2 });
    }

    // ── Footer ──────────────────────────────────────
    const bottom = doc.page.height - 36;
    doc.font('Helvetica').fontSize(8).fillColor(MID_GREY)
       .text('fitnessbymaddy.com  ·  @fitnessbymaddy_  ·  Generated automatically — reply to this WhatsApp for any questions.',
             48, bottom, { width: doc.page.width - 96, align: 'center' });

    doc.end();
  });
}

function sectionHeader(doc, label) {
  doc.moveDown(0.4);
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10)
     .text(label.toUpperCase(), { characterSpacing: 3 });
  doc.moveTo(doc.x, doc.y).lineTo(doc.x + 60, doc.y).strokeColor(GOLD).lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fillColor(CHARCOAL);
}
