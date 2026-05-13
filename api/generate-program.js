const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
  /banned\s*substance/i
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach AI that generates personalised weekly training and nutrition plans. Output valid JSON only.

Rules:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never recommend under 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Adjust based on check-in data (compliance, energy, weight trends)
- Include warm-up and cool-down in every session
- Nutrition: provide macro targets and 3 meal options per meal slot`;

    const userPrompt = `Generate Week ${week_no} program for:
Client: ${client.name || 'Client'}
Program: ${client.program}
${recentCheckins && recentCheckins.length > 0 ? `
Recent check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`).join('\n')}` : 'No previous check-ins (first week).'}

Return JSON with this exact structure:
{
  "workout_plan": {
    "overview": "Brief weekly focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "description",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "cooldown": "description"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2", "Option 3"] }
    ],
    "notes": "Any adjustments or tips"
  },
  "coach_note": "One-liner motivation or context for this week"
}`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const programData = JSON.parse(jsonMatch[0]);

    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(rawText)) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy('Risky program content detected', {
          phone: client.phone,
          clientName: client.name,
          details: `Week ${week_no} — matched: ${pattern.toString()}`
        });

        await db.from('programs').insert({
          client_id,
          week_no,
          workout_plan: programData.workout_plan,
          nutrition_plan: programData.nutrition_plan,
          notes: `FLAGGED: ${pattern.toString()} — awaiting Maddy review`
        });

        return res.status(200).json({ flagged: true, reason: pattern.toString() });
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) console.error('PDF upload error:', uploadErr.message);

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData?.publicUrl || pdfPath;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note
    }).select().single();

    await sendWhatsApp(client.phone, 'weekly_program', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `${week_no}`,
        programData.coach_note || 'New week, new gains!'
      ],
      media: { url: pdfUrl }
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fontSize(14).fill(gold).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#999999')
      .text(`${client.name || 'Client'} | ${client.program?.toUpperCase() || ''}`, 50, 95);

    doc.moveDown(4);

    doc.fontSize(18).fill(gold).font('Helvetica-Bold').text('WORKOUT PLAN');
    doc.moveDown(0.3);
    doc.fontSize(10).fill('#666666').font('Helvetica')
      .text(data.workout_plan?.overview || '');
    doc.moveDown(1);

    if (data.workout_plan?.days) {
      for (const day of data.workout_plan.days) {
        doc.fontSize(13).fill(charcoal).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fill('#888888').font('Helvetica')
            .text(`Warm-up: ${day.warmup}`);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill(charcoal).font('Helvetica')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? `  |  ${ex.notes}` : ''}`, { indent: 10 });
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fill('#888888').font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`);
        }
        doc.moveDown(0.8);
      }
    }

    if (doc.y > 650) doc.addPage();

    doc.moveDown(1);
    doc.fontSize(18).fill(gold).font('Helvetica-Bold').text('NUTRITION PLAN');
    doc.moveDown(0.3);

    const np = data.nutrition_plan;
    if (np) {
      doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
        .text(`Daily Targets: ${np.calories} cal | ${np.protein_g}g protein | ${np.carbs_g}g carbs | ${np.fat_g}g fat`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(11).fill(charcoal).font('Helvetica-Bold').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#444444').font('Helvetica').text(`  → ${opt}`, { indent: 10 });
            }
          }
          doc.moveDown(0.4);
        }
      }

      if (np.notes) {
        doc.moveDown(0.5);
        doc.fontSize(9).fill('#888888').font('Helvetica').text(np.notes);
      }
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke(gold);
    doc.moveDown(0.5);
    doc.fontSize(9).fill('#999999').font('Helvetica')
      .text('Generated by Fitness by Maddy coaching system. For personal use only.', { align: 'center' });

    doc.end();
  });
}
