// Brand-consistent weekly program PDF.
// Black/gold template. Cormorant Garamond-style heavy serif unavailable in pdfkit's
// default set, so we use Times-Bold for serif headers — visually close, embedded fonts
// add runtime weight. Body stays in Helvetica (DM Sans analog).

import PDFDocument from 'pdfkit';

const GOLD = '#B8965A';
const CHARCOAL = '#2C2C2C';
const CREAM = '#FAF8F4';
const MID = '#6B6B6B';

export async function renderProgramPdf({ client, weekNo, plan }) {
  return await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Cover band
      doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
      doc.fillColor(GOLD).font('Times-Italic').fontSize(11)
        .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });
      doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(28)
        .text(`Week ${weekNo} Program`, 50, 60);
      doc.fillColor(GOLD).font('Helvetica').fontSize(10)
        .text(client.name || 'Client', 50, 95);

      doc.moveDown(6);
      doc.fillColor(CHARCOAL).font('Helvetica').fontSize(10);

      // Coach note
      if (plan.notes) {
        doc.moveTo(50, 150).lineTo(doc.page.width - 50, 150).strokeColor(GOLD).lineWidth(0.5).stroke();
        doc.fillColor(MID).fontSize(9).text('COACH NOTE', 50, 160, { characterSpacing: 2 });
        doc.fillColor(CHARCOAL).font('Times-Italic').fontSize(12)
          .text(plan.notes, 50, 175, { width: doc.page.width - 100 });
      }

      doc.moveDown(2);

      // Workout
      section(doc, 'TRAINING');
      const days = plan?.workout_plan?.days || [];
      days.forEach((d) => {
        doc.font('Times-Bold').fontSize(13).fillColor(CHARCOAL)
          .text(`Day ${d.day} — ${d.focus || ''}`);
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(10).fillColor(MID);
        (d.exercises || []).forEach((ex) => {
          const line = `• ${ex.name}  —  ${ex.sets || ''}×${ex.reps || ''}  ·  rest ${ex.rest_sec || 60}s${ex.notes ? `  ·  ${ex.notes}` : ''}`;
          doc.text(line);
        });
        doc.moveDown(0.6);
      });
      const cardio = plan?.workout_plan?.weekly_cardio_min;
      const mobility = plan?.workout_plan?.mobility_daily_min;
      if (cardio || mobility) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(MID)
          .text(`Cardio: ${cardio || 0} min/wk   ·   Mobility: ${mobility || 0} min/day`);
      }

      doc.moveDown(1.5);

      // Nutrition
      section(doc, 'NUTRITION');
      const np = plan?.nutrition_plan || {};
      if (np.daily_calories) {
        doc.font('Times-Bold').fontSize(13).fillColor(CHARCOAL)
          .text(`Target: ${np.daily_calories} kcal / day`);
        doc.font('Helvetica').fontSize(10).fillColor(MID);
        const m = np.macros_g || {};
        doc.text(`Protein ${m.protein || 0}g   ·   Carbs ${m.carbs || 0}g   ·   Fat ${m.fat || 0}g`);
        if (np.hydration_l) doc.text(`Hydration: ${np.hydration_l} L / day`);
        doc.moveDown(0.6);
      }
      (np.meal_framework || []).forEach((m) => {
        doc.font('Times-Bold').fontSize(11).fillColor(CHARCOAL).text(m.meal || 'Meal');
        doc.font('Helvetica').fontSize(10).fillColor(MID);
        (m.ideas || []).forEach((idea) => doc.text(`  · ${idea}`));
        doc.moveDown(0.3);
      });
      if ((np.supplements || []).length) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(MID)
          .text('Supplements (optional): ' + np.supplements.join(', '));
      }

      // Footer
      const footerY = doc.page.height - 50;
      doc.moveTo(50, footerY - 10).lineTo(doc.page.width - 50, footerY - 10)
        .strokeColor(GOLD).lineWidth(0.5).stroke();
      doc.fillColor(MID).font('Helvetica').fontSize(8)
        .text('fitnessbymaddy.com   ·   NASM Certified   ·   Not medical advice', 50, footerY, {
          align: 'center', width: doc.page.width - 100
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function section(doc, label) {
  doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(10)
    .text(label, { characterSpacing: 3 });
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.x + 60, doc.y + 2).strokeColor(GOLD).lineWidth(1).stroke();
  doc.moveDown(0.6);
}
