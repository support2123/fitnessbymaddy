import PDFDocument from 'pdfkit';

// Brand palette — mirror css/style.css.
const CREAM = '#FAF8F4';
const CHARCOAL = '#2C2C2C';
const GOLD = '#B8965A';
const MID = '#6B6B6B';

export async function renderProgramPdf({ clientName, weekNo, plan }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Cover band.
    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10)
      .text('FITNESS BY MADDY', 48, 40, { characterSpacing: 3 });
    doc.fillColor('white').font('Helvetica').fontSize(26)
      .text(`Week ${weekNo} Program`, 48, 60);
    doc.fillColor('#cccccc').fontSize(11)
      .text(clientName || 'Client', 48, 94);

    doc.moveDown(4);
    doc.fillColor(CHARCOAL);

    if (plan.halt) {
      doc.fontSize(16).fillColor(GOLD).text('Paused for Coach Review');
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor(CHARCOAL)
        .text(`Flag: ${plan.halt_reason || 'review_required'}`);
      doc.moveDown(0.5).fillColor(MID)
        .text('Your plan has been routed to Maddy for a personal look before release.');
      doc.end();
      return;
    }

    // Focus.
    sectionTitle(doc, 'Focus This Week');
    doc.fontSize(11).fillColor(CHARCOAL).text(plan.week_focus || '—');
    doc.moveDown(0.8);

    // Workout.
    sectionTitle(doc, 'Training Plan');
    const days = plan?.workout_plan?.days || [];
    for (const d of days) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(CHARCOAL)
        .text(`${d.day || ''} — ${d.title || ''}`);
      doc.font('Helvetica').fontSize(10).fillColor(MID);
      for (const b of d.blocks || []) {
        doc.text(`  • ${b.name}  ·  ${b.sets || '-'}x${b.reps || '-'}  ·  rest ${b.rest_s || 60}s${b.notes ? `  — ${b.notes}` : ''}`);
      }
    }

    // Nutrition.
    doc.moveDown(0.8);
    sectionTitle(doc, 'Nutrition Plan');
    const np = plan.nutrition_plan || {};
    doc.font('Helvetica').fontSize(11).fillColor(CHARCOAL)
      .text(`${np.calories || '—'} kcal  ·  P ${np.protein_g || '—'}g  ·  C ${np.carbs_g || '—'}g  ·  F ${np.fats_g || '—'}g`);
    if (np.notes) { doc.moveDown(0.2).fillColor(MID).fontSize(10).text(np.notes); }
    if (Array.isArray(np.sample_day)) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(CHARCOAL).text('Sample Day');
      doc.font('Helvetica').fontSize(10).fillColor(MID);
      for (const m of np.sample_day) {
        doc.text(`  ${m.meal}: ${(m.items || []).join(', ')}`);
      }
    }

    // Coach note.
    if (plan.notes) {
      doc.moveDown(0.8);
      sectionTitle(doc, 'Coach Note');
      doc.font('Helvetica-Oblique').fontSize(11).fillColor(CHARCOAL).text(plan.notes);
    }

    // Footer.
    doc.fontSize(8).fillColor(MID)
      .text('fitnessbymaddy.com  ·  Generated for one client only. Do not redistribute.',
        48, doc.page.height - 48, { align: 'center', width: doc.page.width - 96 });

    doc.end();
  });
}

function sectionTitle(doc, label) {
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD)
    .text(label.toUpperCase(), { characterSpacing: 3 });
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.x + 40, doc.y + 2).strokeColor(GOLD).stroke();
  doc.moveDown(0.3);
  doc.fillColor(CHARCOAL);
}
