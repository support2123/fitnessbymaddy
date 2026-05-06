const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000', 'under 800',
  'banned substance', 'steroid', 'dnp', 'clenbuterol', 'ephedrine',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'extreme fasting'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeForm } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .limit(1)
      .single();

    const clientProfile = {
      name: client.name,
      program: client.program,
      weekNumber: week_no,
      checkins: recentCheckins || [],
      intake: intakeForm || {},
      programStarted: client.program_started_at
    };

    const anthropic = new Anthropic();

    const systemPrompt = `You are a program architect for Fitness by Maddy, an elite online coaching brand.
Generate a weekly training and nutrition program for a client.

RULES:
- Be warm but expert. Never bro-sciency.
- Calorie recommendations must be safe (minimum 1200 for women, 1500 for men).
- Never recommend banned substances, steroids, or extreme protocols.
- Never over-promise results. Use realistic timelines.
- Base progression on the client's check-in data.
- If client reports pain/injury, recommend rest and flag for review.

OUTPUT FORMAT: Return valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "notes": "..." }] }
    ],
    "rest_days": ["Sunday"],
    "notes": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "..." }
    ],
    "notes": "..."
  },
  "weekly_note": "..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientProfile, null, 2)}`
      }]
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy({
        reason: 'Program generation returned non-JSON',
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} generation failed to produce valid JSON`
      });
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(programData).toLowerCase();

    if (SAFETY_FLAGS.some(flag => fullText.includes(flag))) {
      await escalateToMaddy({
        reason: 'Program flagged for safety review',
        phone: client.phone,
        clientName: client.name,
        message: `Week ${week_no} program contains potentially risky content. Halted for review.`
      });
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: publicUrl?.publicUrl || filePath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note || null
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    const weeklyNote = programData.weekly_note || `Your Week ${week_no} program is ready!`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `Week ${week_no} Program Ready!\n\n${weeklyNote}\n\nYour personalized PDF has been generated. Check your client portal for the full plan.`,
      params: [client.name || 'there', String(week_no)]
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: publicUrl?.publicUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 140).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 40);
    doc.fill('#ffffff').fontSize(14).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 80);
    doc.fill('#888888').fontSize(11)
      .text(`Client: ${client.name || 'Client'} | Program: ${client.program}`, 50, 105);

    let y = 170;

    doc.fill('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fill('#1a1a1a').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 22;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fill('#333333').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}${ex.notes ? '  — ' + ex.notes : ''}`, 60, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (programData.workout_plan?.notes) {
      if (y > 680) { doc.addPage(); y = 50; }
      doc.fill('#666666').fontSize(10).font('Helvetica')
        .text(`Note: ${programData.workout_plan.notes}`, 50, y, { width: 500 });
      y += 30;
    }

    if (y > 600) { doc.addPage(); y = 50; }

    doc.fill('#B8965A').fontSize(18).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    const np = programData.nutrition_plan;
    if (np) {
      doc.fill('#1a1a1a').fontSize(11).font('Helvetica-Bold')
        .text(`Daily Targets: ${np.calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fill('#333333').fontSize(10).font('Helvetica')
            .text(`${meal.meal}: ${meal.suggestion}`, 60, y, { width: 480 });
          y += 18;
        }
      }

      if (np.notes) {
        y += 10;
        doc.fill('#666666').fontSize(10).font('Helvetica')
          .text(`Note: ${np.notes}`, 50, y, { width: 500 });
      }
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(8).font('Helvetica')
      .text('FITNESS BY MADDY | fitnessbymaddy.com | Confidential', 50, doc.page.height - 28);

    doc.end();
  });
}
