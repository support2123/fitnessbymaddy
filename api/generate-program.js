const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarms/i,
  /lose\s*\d+\s*kg.*in.*\d+\s*day/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const { client_id, week_no } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*, leads(intake_data, market)')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: recentCheckins } = await db
    .from('checkins')
    .select('*')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(2);

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified personal trainer and nutrition coach creating weekly programs for FitnessByMaddy clients. Generate evidence-based, safe, progressive programs. Never recommend:
- Extreme calorie deficits (below 1200 cal for women, 1500 for men)
- Banned substances or supplements
- Unrealistic timelines
- Exercises contraindicated for reported injuries

Output strict JSON with keys: workout_plan (array of day objects with exercises, sets, reps, rest), nutrition_plan (object with calories, protein, carbs, fats, meal_timing, sample_meals), notes (string with week focus).`;

  const userPrompt = `Client: ${client.name}
Program: ${client.program} (Week ${week_no} of ${client.program === '12wk' ? 12 : 6})
${client.leads?.intake_data ? `Profile: ${JSON.stringify(client.leads.intake_data)}` : ''}
${recentCheckins && recentCheckins.length > 0 ? `Recent check-ins: ${JSON.stringify(recentCheckins)}` : 'No previous check-ins (first week).'}

Generate the Week ${week_no} program. Adjust intensity based on compliance and energy scores if available. JSON only, no markdown.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const responseText = message.content[0].text;

  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(responseText)) {
      await notifyMaddy('Program flagged as potentially unsafe', {
        phone: client.phone,
        info: `Week ${week_no} program for ${client.name} flagged. Pattern: ${pattern}`,
      });
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }
  }

  let programData;
  try {
    programData = JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      programData = JSON.parse(jsonMatch[0]);
    } else {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }
  }

  const pdfBuffer = await generatePDF(client, week_no, programData);

  const filePath = `clients/${client_id}/week_${week_no}.pdf`;
  await db.storage.from('programs').upload(filePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  const { data: urlData } = db.storage.from('programs').getPublicUrl(filePath);
  const pdfUrl = urlData?.publicUrl || filePath;

  await db.from('programs').insert({
    client_id,
    week_no,
    generated_at: new Date().toISOString(),
    pdf_url: pdfUrl,
    whatsapp_sent_at: null,
    workout_plan: programData.workout_plan,
    nutrition_plan: programData.nutrition_plan,
    notes: programData.notes,
  });

  await sendTemplate(client.phone, 'weekly_program', [
    client.name || 'there',
    String(week_no),
    programData.notes || 'New week, new gains!',
    pdfUrl,
  ]);

  await db.from('programs')
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq('client_id', client_id)
    .eq('week_no', week_no);

  return res.status(200).json({ action: 'program_generated', week_no, pdf_url: pdfUrl });
};

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#D4AF7A')
      .text('FITNESS BY MADDY', 50, 40);
    doc.fontSize(14).fillColor('#ffffff')
      .text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fillColor('#999999')
      .text(`${client.name} | ${client.program.toUpperCase()}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a1a1a')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (programData.workout_plan && Array.isArray(programData.workout_plan)) {
      for (const day of programData.workout_plan) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#B8965A')
          .text(day.day || day.name || 'Training Day');
        doc.moveDown(0.3);

        if (day.exercises && Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            doc.fontSize(10).font('Helvetica').fillColor('#333333')
              .text(`  • ${ex.name || ex.exercise} — ${ex.sets}x${ex.reps} (Rest: ${ex.rest || '60s'})`, { indent: 20 });
          }
        }
        doc.moveDown(0.5);
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#1a1a1a');
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#D4AF7A')
      .text('NUTRITION PLAN', 50, 20);

    doc.moveDown(3);

    if (programData.nutrition_plan) {
      const np = programData.nutrition_plan;
      doc.fontSize(11).font('Helvetica').fillColor('#333333');
      doc.text(`Calories: ${np.calories || 'TBD'} kcal`);
      doc.text(`Protein: ${np.protein || 'TBD'}g | Carbs: ${np.carbs || 'TBD'}g | Fats: ${np.fats || 'TBD'}g`);
      doc.moveDown();

      if (np.meal_timing) {
        doc.font('Helvetica-Bold').text('Meal Timing:');
        doc.font('Helvetica').text(
          Array.isArray(np.meal_timing) ? np.meal_timing.join('\n') : String(np.meal_timing)
        );
        doc.moveDown();
      }

      if (np.sample_meals && Array.isArray(np.sample_meals)) {
        doc.font('Helvetica-Bold').text('Sample Meals:');
        for (const meal of np.sample_meals) {
          doc.font('Helvetica').text(`  • ${typeof meal === 'string' ? meal : JSON.stringify(meal)}`);
        }
      }
    }

    if (programData.notes) {
      doc.moveDown(2);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#B8965A').text('COACH NOTES:');
      doc.font('Helvetica').fillColor('#333333').text(programData.notes);
    }

    doc.moveDown(3);
    doc.fontSize(8).fillColor('#999999')
      .text('Generated by FitnessByMaddy Coaching System. For questions, WhatsApp +917082478374.', { align: 'center' });

    doc.end();
  });
}
