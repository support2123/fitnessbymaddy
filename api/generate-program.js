const { getSupabase } = require('../lib/supabase');
const { sendDocument } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const PROGRAM_ARCHITECT_PROMPT = `You are Maddy's AI program architect for FitnessByMaddy.
You create personalized weekly workout and nutrition plans.

RULES:
- Never recommend extreme calorie cuts (below 1200 kcal for women, 1500 for men)
- Never recommend banned or unsafe substances
- Never promise unrealistic timelines ("lose 10kg in 1 week")
- Plans must be progressive and sustainable
- Consider injuries, medical conditions, and experience level
- Be specific: sets, reps, rest times, exact meals with portions

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..."}
        ],
        "cardio": "...",
        "duration_mins": 45
      }
    ],
    "deload_notes": "..."
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meals": [
      {"meal": "Breakfast", "options": ["..."], "macros": "..."}
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_note": "Short motivational + coaching note for this week",
  "focus_areas": ["..."]
}`;

const SAFETY_FLAGS = [
  'extreme calorie', 'starvation', 'anabolic', 'steroid',
  'crash diet', 'below 1000', 'below 800', 'DNP', 'clenbuterol',
  'lose 10kg in', 'lose 20lbs in 1 week'
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: lastProgram } = await db
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const clientContext = buildClientContext(client, recentCheckins, lastProgram, week_no);

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: PROGRAM_ARCHITECT_PROMPT,
      messages: [{
        role: 'user',
        content: clientContext
      }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const responseStr = JSON.stringify(programData).toLowerCase();
    for (const flag of SAFETY_FLAGS) {
      if (responseStr.includes(flag.toLowerCase())) {
        const { notifyMaddy } = require('../lib/whatsapp');
        await notifyMaddy(
          'Program safety flag',
          `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nFlag: "${flag}"`
        );
        await db.from('programs').insert({
          client_id,
          week_no,
          workout_plan: programData.workout_plan,
          nutrition_plan: programData.nutrition_plan,
          notes: `FLAGGED: ${flag} — awaiting Maddy review`
        });
        return res.status(200).json({ ok: true, flagged: true, reason: flag });
      }
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const fileName = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('clients')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(fileName);
    const pdfUrl = urlData?.publicUrl || '';

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_note
    });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    await sendDocument(
      client.phone,
      pdfUrl,
      programData.weekly_note || `Week ${week_no} program ready!`
    );

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({
      ok: true,
      program_week: week_no,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildClientContext(client, checkins, lastProgram, weekNo) {
  let ctx = `CLIENT PROFILE:
Name: ${client.name || 'Unknown'}
Program: ${client.program}
Week: ${weekNo} of 12
Started: ${client.program_started_at}
`;

  if (checkins && checkins.length > 0) {
    ctx += `\nRECENT CHECK-INS:\n`;
    for (const c of checkins) {
      ctx += `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, `;
      ctx += `Compliance ${c.compliance_score || 'N/A'}/10, Energy ${c.energy || 'N/A'}/10`;
      if (c.issues) ctx += `, Issues: ${c.issues}`;
      if (c.next_week_focus) ctx += `, Focus: ${c.next_week_focus}`;
      ctx += `\n`;
    }
  }

  if (lastProgram) {
    ctx += `\nLAST PROGRAM (Week ${lastProgram.week_no}):\n`;
    ctx += `Focus areas: ${JSON.stringify(lastProgram.workout_plan?.focus_areas || [])}\n`;
    ctx += `Calories: ${lastProgram.nutrition_plan?.calories || 'N/A'}\n`;
  }

  ctx += `\nGenerate Week ${weekNo} program. Progress from last week appropriately.`;
  return ctx;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#1a1a1a');
    doc.fontSize(28).fill('#D4AF7A')
      .text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fontSize(14).fill('#ffffff')
      .text(`Week ${weekNo} Program`, 50, 75, { align: 'center' });
    doc.fontSize(10).fill('#999999')
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 95, { align: 'center' });

    doc.moveDown(4);

    if (programData.weekly_note) {
      doc.fontSize(11).fill('#B8965A').text(programData.weekly_note, 50, doc.y, {
        width: doc.page.width - 100,
        align: 'center'
      });
      doc.moveDown(1.5);
    }

    doc.fontSize(18).fill('#1a1a1a').text('WORKOUT PLAN', 50, doc.y);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#D4AF7A');
    doc.moveDown(0.8);

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        if (doc.y > doc.page.height - 150) doc.addPage();

        doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus}`, 50, doc.y);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C')
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60, doc.y);
            if (ex.notes) {
              doc.fontSize(8).fill('#6B6B6B').text(`    ${ex.notes}`, 70, doc.y);
            }
            doc.moveDown(0.2);
          }
        }

        if (day.cardio) {
          doc.fontSize(9).fill('#6B6B6B').text(`  Cardio: ${day.cardio}`, 60, doc.y);
        }
        doc.moveDown(0.8);
      }
    }

    if (doc.y > doc.page.height - 250) doc.addPage();

    doc.moveDown(1);
    doc.fontSize(18).fill('#1a1a1a').text('NUTRITION PLAN', 50, doc.y);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#D4AF7A');
    doc.moveDown(0.8);

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Target: ${nutrition.calories} kcal | Protein: ${nutrition.protein_g}g | Carbs: ${nutrition.carbs_g}g | Fats: ${nutrition.fats_g}g`, 50, doc.y);
      doc.moveDown(0.8);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (doc.y > doc.page.height - 100) doc.addPage();

          doc.fontSize(12).fill('#B8965A').text(meal.meal, 50, doc.y);
          doc.moveDown(0.2);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#2C2C2C').text(`  • ${opt}`, 60, doc.y);
              doc.moveDown(0.15);
            }
          }
          if (meal.macros) {
            doc.fontSize(8).fill('#6B6B6B').text(`    ${meal.macros}`, 70, doc.y);
          }
          doc.moveDown(0.5);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${nutrition.hydration}`, 50, doc.y);
      }
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill('#1a1a1a');
    doc.fontSize(8).fill('#999999')
      .text('fitnessbymaddy.com | This program is personalized — do not share.', 50, doc.page.height - 28, {
        width: doc.page.width - 100,
        align: 'center'
      });

    doc.end();
  });
}
