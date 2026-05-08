const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(1|2)\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const prompt = buildPrompt(client, recentCheckins || [], prevPrograms || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const fullText = JSON.stringify(parsed);
    const isRisky = RISKY_PATTERNS.some((p) => p.test(fullText));
    if (isRisky) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Risky program content detected',
        client.phone,
        `Week ${week_no} program flagged for review`
      );
      return res.json({ flagged: true, reason: 'Content flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: publicUrl } = supabase.storage
      .from('clients')
      .getPublicUrl(pdfPath);

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: publicUrl?.publicUrl || pdfPath,
        workout_plan: parsed.workout_plan || parsed.workout || null,
        nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
        notes: parsed.notes || null,
      })
      .select()
      .single();

    const market = detectMarket(client.phone);
    const note = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! 💪`
      : `Your Week ${week_no} program is ready! 💪`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      note,
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ success: true, program_id: program.id });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const checkinSummary = checkins
    .map(
      (c) =>
        `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    )
    .join('\n');

  const prevSummary = prevPrograms
    .map((p) => `Week ${p.week_no} notes: ${p.notes || 'none'}`)
    .join('\n');

  return `You are an expert fitness coach designing Week ${weekNo} of a 12-week personalised program.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM NOTES:
${prevSummary || 'None (first week)'}

INSTRUCTIONS:
- Design a complete 7-day workout plan with exercises, sets, reps, rest periods
- Design a nutrition plan with daily macros, meal timing, and sample meals
- Be progressive: increase difficulty based on compliance and energy levels
- If compliance is low, simplify and focus on adherence
- If energy is low, reduce volume slightly and add recovery protocols
- NEVER recommend extreme calorie restriction (below 1200 cal for women, 1500 for men)
- NEVER recommend any banned or dangerous substances
- Keep timelines realistic

Return ONLY valid JSON in this format:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": ""}] },
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "time": "8:00 AM", "options": ["..."] }
    ],
    "notes": ""
  },
  "notes": "Coach notes for this week"
}`;
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#D4AF7A').text(client.name || 'Client', 50, 95, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);

    const workout = program.workout_plan || program.workout;
    if (workout?.days) {
      for (const day of workout.days) {
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc
              .fontSize(10)
              .fill('#6B6B6B')
              .text(`  • ${ex.name}  |  ${ex.sets}×${ex.reps}  |  Rest: ${ex.rest}`, 60);
          }
        }
        doc.moveDown(0.5);
      }
    }

    if (doc.y > 650) doc.addPage();
    doc.moveDown(1);

    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);

    const nutrition = program.nutrition_plan || program.nutrition;
    if (nutrition) {
      doc
        .fontSize(11)
        .fill('#2C2C2C')
        .text(
          `Daily Target: ${nutrition.daily_calories} cal  |  P: ${nutrition.protein_g}g  |  C: ${nutrition.carbs_g}g  |  F: ${nutrition.fat_g}g`,
          50
        );
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(11).fill('#2C2C2C').text(`${meal.meal} (${meal.time})`, 50);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  → ${opt}`, 60);
            }
          }
          doc.moveDown(0.3);
        }
      }
    }

    if (program.notes) {
      doc.moveDown(1);
      doc.fontSize(12).fill('#B8965A').text('COACH NOTES', 50);
      doc.fontSize(10).fill('#6B6B6B').text(program.notes, 50);
    }

    doc
      .fontSize(8)
      .fill('#C8B89A')
      .text('© Fitness by Maddy — fitnessbymaddy.com', 50, doc.page.height - 40, {
        align: 'center',
      });

    doc.end();
  });
}
