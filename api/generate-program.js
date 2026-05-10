const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { handleCors, PROGRAM_NAMES } = require('./_lib/utils');

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme cut',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for',
];

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('clients')
        .download(`intake/${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (_) {}

    const prompt = buildPrompt(client, checkins || [], intakeData, week_no);

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text;

    let parsed;
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch (_) {
      console.error('Failed to parse Claude response as JSON');
      return res.status(500).json({ error: 'Invalid program format from AI' });
    }

    const fullText = JSON.stringify(parsed).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => fullText.includes(flag));
    if (flagged) {
      await escalateToMaddy('Risky content in generated program', {
        phone: client.phone,
        name: client.name,
        details: `Week ${week_no} program flagged for safety review`
      });
      return res.status(200).json({
        success: false,
        reason: 'flagged_for_review',
        message: 'Program flagged for Maddy review before sending'
      });
    }

    const pdfBuffer = await generatePDF(client, parsed, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: urlData } = await supabase.storage
      .from('clients')
      .createSignedUrl(pdfPath, 7 * 24 * 60 * 60);

    const pdfUrl = urlData?.signedUrl || pdfPath;

    const { error: progErr } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan || parsed.workout || null,
      nutrition_plan: parsed.nutrition_plan || parsed.nutrition || null,
      notes: parsed.notes || null
    });

    if (progErr) console.error('Program insert error:', progErr.message);

    const contextNote = parsed.notes
      || `Week ${week_no} program ready — let's keep the momentum going!`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      String(week_no),
      contextNote.slice(0, 100),
      pdfUrl
    ], true);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, intake, weekNo) {
  const checkinSummary = checkins.map(c => (
    `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, ` +
    `Compliance ${c.compliance_score}/10, Energy ${c.energy}/10` +
    (c.issues ? `, Issues: ${c.issues}` : '')
  )).join('\n');

  const intakeInfo = intake
    ? `Age: ${intake.age}, Gender: ${intake.gender}, Goal: ${intake.goal}, ` +
      `Injuries: ${intake.injuries || 'none'}, Diet: ${intake.diet_preference || 'flexible'}, ` +
      `Schedule: ${intake.schedule || 'flexible'}, Experience: ${intake.experience_level || 'intermediate'}`
    : 'No intake data available';

  return `You are Maddy's program architect — a world-class fitness coach assistant.
Create a Week ${weekNo} training and nutrition program for this client.

CLIENT PROFILE:
Name: ${client.name || 'Client'}
Program: ${PROGRAM_NAMES[client.program] || client.program}
${intakeInfo}

RECENT CHECK-INS:
${checkinSummary || 'No check-in data yet (first week)'}

RULES:
- Be progressive: if compliance is high, increase intensity slightly
- If energy is low or issues reported, adjust volume down
- Never prescribe below 1200 calories for women or 1500 for men
- Never recommend supplements beyond basic protein/creatine/vitamins
- Include rest days and deload guidance
- All exercises must have sets, reps, tempo, and rest periods
- Nutrition must include macros and 2 meal options per slot

Respond ONLY with valid JSON in this format:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "tempo": "3-1-1-0", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros": { "protein_g": 140, "carbs_g": 180, "fat_g": 55 },
    "meals": [
      { "slot": "Breakfast", "option_a": "...", "option_b": "..." }
    ]
  },
  "notes": "One-liner context for WhatsApp message"
}
\`\`\``;
}

function generatePDF(client, program, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'left' });
    doc.fill('#B8965A').fontSize(11)
      .text(client.name || 'Client', 50, 95, { align: 'left' });

    doc.fill('#2C2C2C');
    let y = 150;

    const workout = program.workout_plan || program.workout;
    if (workout && workout.days) {
      doc.fontSize(18).font('Helvetica-Bold').fill('#2C2C2C')
        .text('WORKOUT PLAN', 50, y);
      y += 30;

      doc.moveTo(50, y).lineTo(545, y).stroke('#B8965A');
      y += 15;

      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).font('Helvetica-Bold').fill('#B8965A')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 22;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).font('Helvetica-Bold').fill('#2C2C2C')
              .text(ex.name, 70, y);
            doc.fontSize(9).font('Helvetica').fill('#6B6B6B')
              .text(`${ex.sets} x ${ex.reps} | Tempo: ${ex.tempo || '-'} | Rest: ${ex.rest || '-'}`, 70, y + 13);
            if (ex.notes) {
              doc.fontSize(8).fill('#999')
                .text(ex.notes, 70, y + 25);
              y += 38;
            } else {
              y += 28;
            }
          }
        }

        if (day.cardio) {
          doc.fontSize(9).font('Helvetica').fill('#6B6B6B')
            .text(`Cardio: ${day.cardio}`, 70, y);
          y += 18;
        }

        y += 10;
      }
    }

    const nutrition = program.nutrition_plan || program.nutrition;
    if (nutrition) {
      if (y > 550) { doc.addPage(); y = 50; }

      y += 10;
      doc.fontSize(18).font('Helvetica-Bold').fill('#2C2C2C')
        .text('NUTRITION PLAN', 50, y);
      y += 30;
      doc.moveTo(50, y).lineTo(545, y).stroke('#B8965A');
      y += 15;

      if (nutrition.daily_calories) {
        doc.fontSize(11).font('Helvetica-Bold').fill('#2C2C2C')
          .text(`Daily Calories: ${nutrition.daily_calories} kcal`, 50, y);
        y += 18;
      }

      if (nutrition.macros) {
        const m = nutrition.macros;
        doc.fontSize(10).font('Helvetica').fill('#6B6B6B')
          .text(`Protein: ${m.protein_g}g | Carbs: ${m.carbs_g}g | Fat: ${m.fat_g}g`, 50, y);
        y += 25;
      }

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(11).font('Helvetica-Bold').fill('#B8965A')
            .text(meal.slot, 50, y);
          y += 16;
          doc.fontSize(9).font('Helvetica').fill('#2C2C2C')
            .text(`Option A: ${meal.option_a}`, 70, y, { width: 460 });
          y += doc.heightOfString(`Option A: ${meal.option_a}`, { width: 460 }) + 4;
          doc.text(`Option B: ${meal.option_b}`, 70, y, { width: 460 });
          y += doc.heightOfString(`Option B: ${meal.option_b}`, { width: 460 }) + 12;
        }
      }
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#999')
        .text(
          `fitnessbymaddy.com | Week ${weekNo} | ${new Date().toLocaleDateString('en-IN')}`,
          50, doc.page.height - 40,
          { align: 'center', width: doc.page.width - 100 }
        );
    }

    doc.end();
  });
}
