const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation, maskPhone } = require('../lib/whatsapp');
const { PROGRAM_NAMES } = require('../lib/helpers');

const SAFETY_FLAGS = [
  'below 1200 calories', 'below 1000 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10 kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for Fitness by Maddy.
You create weekly workout and nutrition plans that are:
- Evidence-based and safe
- Tailored to the client's current data and progress
- Progressive (building on previous weeks)
- Realistic and sustainable

NEVER recommend:
- Calorie intake below 1200 for women or 1500 for men
- Any banned substances or supplements
- Unrealistic timelines (e.g., "lose 10kg in 1 week")
- Exercises that could aggravate reported injuries

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_note": "Short motivational + tactical note for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

Program: ${PROGRAM_NAMES[client.program] || client.program}
Client: ${client.name || 'Client'}
Started: ${client.program_started_at}

${recentCheckins?.length ? `Recent check-ins:
${recentCheckins.map(c => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? `, Issues: ${c.issues}` : ''}`).join('\n')}` : 'No previous check-ins yet (Week 1).'}

Create an appropriate Week ${week_no} program. If this is week 1, start with a foundation phase. If later weeks show good compliance, progressively overload. If compliance is low, simplify.`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = response.content[0].text;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Claude did not return valid JSON');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const responseLC = responseText.toLowerCase();
    const hasSafetyIssue = SAFETY_FLAGS.some(f => responseLC.includes(f));
    if (hasSafetyIssue) {
      await sendEscalation(
        `Program for ${maskPhone(client.phone)} Week ${week_no} flagged for safety review. Auto-send halted.`
      );
      await db.from('programs').insert({
        client_id, week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED FOR SAFETY REVIEW — not auto-sent',
      });
      return res.status(200).json({ ok: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const { data: programRecord } = await db.from('programs').insert({
      client_id, week_no,
      pdf_url: publicUrl.publicUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note,
    }).select().single();

    await sendWhatsApp({
      phone: client.phone,
      body: `Your Week ${week_no} program is ready! 📋\n\n${programData.weekly_note || 'Keep pushing — consistency wins.'}\n\nPDF: ${publicUrl.publicUrl}`,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    return res.status(200).json({ ok: true, program_id: programRecord.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });
    doc.fontSize(10).fill('#C8B89A')
      .text(`${client.name || 'Client'} | ${PROGRAM_NAMES[client.program] || client.program}`, 50, 95);

    let y = 150;

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50, y);
    y += 30;

    if (data.workout_plan?.days) {
      for (const day of data.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.rect(50, y, doc.page.width - 100, 24).fill('#F0EAE0');
        doc.fontSize(11).fill('#2C2C2C')
          .text(`${day.day} — ${day.focus}`, 60, y + 6, { characterSpacing: 1 });
        y += 30;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#2C2C2C')
              .text(ex.name, 70, y);
            doc.fill('#6B6B6B')
              .text(`${ex.sets} × ${ex.reps} | Rest: ${ex.rest}`, 250, y);
            if (ex.notes) {
              y += 14;
              doc.fontSize(9).fill('#B8965A').text(ex.notes, 70, y);
            }
            y += 18;
          }
        }
        y += 10;
      }
    }

    if (data.workout_plan?.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      y += 10;
      doc.fontSize(11).fill('#B8965A').text('CARDIO', 50, y);
      y += 18;
      const c = data.workout_plan.cardio;
      doc.fontSize(10).fill('#6B6B6B')
        .text(`${c.frequency} | ${c.type} | ${c.duration}`, 70, y);
      y += 30;
    }

    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50, y);
    y += 30;

    if (data.nutrition_plan) {
      const n = data.nutrition_plan;
      doc.rect(50, y, doc.page.width - 100, 50).fill('#2C2C2C');
      doc.fontSize(10).fill('#B8965A')
        .text(`CALORIES: ${n.calories}`, 70, y + 10)
        .text(`PROTEIN: ${n.protein_g}g`, 200, y + 10)
        .text(`CARBS: ${n.carbs_g}g`, 320, y + 10)
        .text(`FAT: ${n.fat_g}g`, 430, y + 10);
      y += 65;

      if (n.meals) {
        for (const meal of n.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 60, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill('#6B6B6B').text(`→ ${opt}`, 80, y);
              y += 14;
            }
          }
          y += 8;
        }
      }
    }

    if (data.weekly_note) {
      if (y > 680) { doc.addPage(); y = 50; }
      y += 20;
      doc.rect(50, y, doc.page.width - 100, 1).fill('#E8E3DC');
      y += 15;
      doc.fontSize(10).fill('#B8965A').text('NOTE FROM MADDY', 50, y);
      y += 18;
      doc.fontSize(10).fill('#6B6B6B').text(data.weekly_note, 50, y, {
        width: doc.page.width - 100,
      });
    }

    doc.end();
  });
}
