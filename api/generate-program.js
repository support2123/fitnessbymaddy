const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/phone');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 800', 'below 1000', 'starvation',
  'anabolic', 'steroid', 'clenbuterol', 'dnp', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    const anthropic = new Anthropic();

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create weekly personalized workout and nutrition plans.

RULES:
- Programs must be safe, evidence-based, and appropriate for the client
- Never recommend extreme calorie restriction (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned substances, steroids, or unproven supplements
- Never promise unrealistic timelines (max 1kg/week fat loss)
- All exercises must include sets, reps, rest periods
- Nutrition must include macros and meal timing
- Output MUST be valid JSON with "workout_plan" and "nutrition_plan" keys`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Client: ${client.name || 'Client'}
Program: ${client.program}
${recentCheckins?.length ? `
Recent check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}
` : 'No prior check-ins (Week 1).'}

Return JSON:
{
  "workout_plan": {
    "focus": "string",
    "days": [
      {
        "day": "Monday",
        "type": "Upper Body",
        "exercises": [
          { "name": "string", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "string",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["string"] }
    ],
    "supplements": ["string"],
    "hydration": "string"
  },
  "coach_note": "string"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const program = JSON.parse(jsonMatch[0]);
    const programText = JSON.stringify(program).toLowerCase();

    const flagged = SAFETY_FLAGS.some(flag => programText.includes(flag));
    if (flagged) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Program safety flag',
        phone: client.phone,
        context: `Week ${week_no} program flagged for review`,
      });
      return res.status(200).json({ action: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, program);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload failed:', uploadErr.message);
    }

    const { data: urlData } = db.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.coach_note || null,
    });

    const market = detectMarket(client.phone);
    const msg = market === 'IN'
      ? `Week ${week_no} ka program ready hai! 📋💪\n\n${program.coach_note || ''}`
      : `Your Week ${week_no} program is ready! 📋💪\n\n${program.coach_note || ''}`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [client.name || 'there', String(week_no)],
      body: msg,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, 595, 100).fill('#1a1a1a');
    doc.fontSize(28).fill('#B8965A').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(14).fill('#ffffff').font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65);
    doc.fontSize(10).fill('#888888')
      .text(`Prepared for ${client.name || 'Client'}`, 350, 65);

    doc.moveDown(3);

    // Workout Plan
    const wp = program.workout_plan;
    doc.fontSize(18).fill('#B8965A').font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, 130);
    doc.fontSize(10).fill('#666666').font('Helvetica')
      .text(`Focus: ${wp.focus || 'General'}`, 50, 155);

    let y = 175;
    if (wp.days) {
      for (const day of wp.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.rect(50, y, 495, 24).fill('#2C2C2C');
        doc.fontSize(11).fill('#B8965A').font('Helvetica-Bold')
          .text(`${day.day} — ${day.type}`, 60, y + 6);
        y += 30;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 740) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#333333').font('Helvetica')
              .text(`• ${ex.name}`, 70, y);
            doc.fill('#888888')
              .text(`${ex.sets} x ${ex.reps} | Rest: ${ex.rest}`, 300, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    // Nutrition Plan
    if (y > 600) { doc.addPage(); y = 50; }
    y += 20;
    doc.fontSize(18).fill('#B8965A').font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 25;

    const np = program.nutrition_plan;
    doc.fontSize(10).fill('#333333').font('Helvetica')
      .text(`Calories: ${np.calories} kcal | Protein: ${np.protein_g}g | Carbs: ${np.carbs_g}g | Fat: ${np.fat_g}g`, 50, y);
    y += 20;

    if (np.meals) {
      for (const meal of np.meals) {
        if (y > 740) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill('#2C2C2C').font('Helvetica-Bold')
          .text(`${meal.meal} (${meal.time})`, 60, y);
        y += 16;
        if (meal.options) {
          for (const opt of meal.options) {
            doc.fontSize(9).fill('#666666').font('Helvetica')
              .text(`  → ${opt}`, 70, y);
            y += 14;
          }
        }
        y += 6;
      }
    }

    // Coach Note
    if (program.coach_note) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.rect(50, y, 495, 50).fill('#FAF8F4');
      doc.fontSize(10).fill('#B8965A').font('Helvetica-Bold')
        .text("COACH'S NOTE", 60, y + 8);
      doc.fontSize(9).fill('#333333').font('Helvetica')
        .text(program.coach_note, 60, y + 22, { width: 475 });
    }

    // Footer
    doc.fontSize(8).fill('#CCCCCC').font('Helvetica')
      .text('© Fitness by Maddy — For personal use only', 50, 780, { align: 'center' });

    doc.end();
  });
}
