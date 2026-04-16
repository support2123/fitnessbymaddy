import PDFDocument from 'pdfkit';

// Render a branded black/gold PDF from a program plan.
// Returns a Buffer.
export function renderProgramPdf({ client, weekNo, plan }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: {
      Title: `Week ${weekNo} — ${client.name}`,
      Author: 'FitnessByMaddy'
    }});
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const GOLD = '#B8965A';
    const CHAR = '#2C2C2C';
    const GREY = '#6B6B6B';

    // Header band
    doc.rect(0, 0, doc.page.width, 90).fill(CHAR);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(22)
       .text('FITNESS BY MADDY', 56, 32, { characterSpacing: 3 });
    doc.fillColor(GOLD).fontSize(11).font('Helvetica')
       .text(`WEEK ${weekNo}  ·  ${client.program.toUpperCase()}`, 56, 62, { characterSpacing: 2 });

    doc.moveDown(3);
    doc.fillColor(CHAR).font('Helvetica-Bold').fontSize(18)
       .text(`Plan for ${client.name || 'Client'}`, 56, 120);
    doc.fillColor(GREY).font('Helvetica').fontSize(10)
       .text(new Date().toDateString(), 56, 144);

    // Coach note
    if (plan.notes) {
      doc.moveDown(2);
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(11)
         .text("COACH'S NOTE", { characterSpacing: 2 });
      doc.moveDown(0.3);
      doc.fillColor(CHAR).font('Helvetica').fontSize(11).text(plan.notes);
    }

    // Workout
    doc.moveDown(1.5);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(12)
       .text('TRAINING', { characterSpacing: 2 });
    doc.moveDown(0.4);
    doc.fillColor(GREY).font('Helvetica').fontSize(10)
       .text(`Split: ${plan.workout_plan?.split || '—'}`);
    doc.moveDown(0.5);

    for (const day of (plan.workout_plan?.days || [])) {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.fillColor(CHAR).font('Helvetica-Bold').fontSize(12)
         .text(`${day.day} — ${day.focus || ''}`);
      doc.moveDown(0.2);
      for (const ex of (day.exercises || [])) {
        const line = `• ${ex.name}  —  ${ex.sets || 3}×${ex.reps || '10'}  rest ${ex.rest || '90s'}`;
        doc.fillColor(CHAR).font('Helvetica').fontSize(10).text(line);
        if (ex.notes) {
          doc.fillColor(GREY).fontSize(9).text(`    ${ex.notes}`);
        }
      }
      doc.moveDown(0.6);
    }

    // Nutrition
    if (doc.y > doc.page.height - 200) doc.addPage();
    doc.moveDown(1);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(12)
       .text('NUTRITION', { characterSpacing: 2 });
    doc.moveDown(0.4);
    const n = plan.nutrition_plan || {};
    doc.fillColor(CHAR).font('Helvetica').fontSize(10)
       .text(`Target: ${n.kcal_target || '—'} kcal · P ${n.protein_g || '—'}g · C ${n.carbs_g || '—'}g · F ${n.fats_g || '—'}g · Water ${n.hydration_l || '—'}L`);
    doc.moveDown(0.5);
    for (const meal of (n.meals || [])) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      doc.fillColor(CHAR).font('Helvetica-Bold').fontSize(11).text(meal.meal);
      for (const item of (meal.items || [])) {
        doc.fillColor(CHAR).font('Helvetica').fontSize(10).text(`  • ${item}`);
      }
      if (meal.notes) doc.fillColor(GREY).fontSize(9).text(`  ${meal.notes}`);
      doc.moveDown(0.4);
    }

    // Footer
    doc.fillColor(GREY).font('Helvetica').fontSize(9)
       .text('fitnessbymaddy.com  ·  Not medical advice. Consult your doctor for any condition.',
         56, doc.page.height - 40, { width: doc.page.width - 112 });

    doc.end();
  });
}
