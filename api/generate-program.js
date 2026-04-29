const { getSupabase } = require('./_lib/supabase');
const { sendTemplateForced, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800', 'starvation',
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sarm',
  'steroid', 'anabolic', 'testosterone injection',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafety(content) {
  const lower = JSON.stringify(content).toLowerCase();
  for (const flag of SAFETY_FLAGS) {
    if (lower.includes(flag)) return { safe: false, flag };
  }
  return { safe: true, flag: null };
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const lastCheckins = checkins.slice(-2);
  const weekNo = lastCheckins.length > 0
    ? Math.max(...lastCheckins.map(c => c.week_no)) + 1
    : 1;

  const prompt = `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Current week: ${weekNo}

${lastCheckins.length > 0 ? `RECENT CHECK-INS:
${lastCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins (first week).'}

Generate a JSON response with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min incline walk + dynamic stretches",
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Sunday"],
    "weekly_volume_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"], "macros_approx": "P:40 C:50 F:15" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": ""
  },
  "context_note": "One-liner summary for WhatsApp message"
}

Rules:
- Be evidence-based and safe
- Never recommend extreme calorie deficits (below 1200 for women, 1500 for men)
- Never recommend banned substances or steroids
- Adjust based on check-in data (compliance, energy, issues)
- If client reported pain/injury, modify exercises to avoid aggravation
- Keep recommendations realistic and sustainable`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fontSize(28).fillColor('#B8965A')
      .text('FITNESS BY MADDY', 50, 30, { align: 'center' });
    doc.fontSize(14).fillColor('#FFFFFF')
      .text(`Week ${weekNo} Program — ${client.name}`, 50, 65, { align: 'center' });

    doc.moveDown(3);

    doc.fontSize(20).fillColor('#2C2C2C')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    const workout = programData.workout_plan;
    if (workout?.days) {
      for (const day of workout.days) {
        if (doc.y > 680) doc.addPage();

        doc.fontSize(14).fillColor('#B8965A')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Warm-up: ${day.warmup}`, 60);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fillColor('#2C2C2C')
              .text(`  • ${ex.name}  —  ${ex.sets} x ${ex.reps}  (Rest: ${ex.rest})`, 60);
            if (ex.notes) {
              doc.fontSize(8).fillColor('#6B6B6B').text(`    ${ex.notes}`, 70);
            }
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fillColor('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.8);
      }
    }

    if (doc.y > 550) doc.addPage();

    doc.moveDown(1);
    doc.fontSize(20).fillColor('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#B8965A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    const nutrition = programData.nutrition_plan;
    if (nutrition) {
      doc.fontSize(12).fillColor('#2C2C2C')
        .text(`Daily Targets: ${nutrition.calories} kcal  |  P: ${nutrition.protein_g}g  |  C: ${nutrition.carbs_g}g  |  F: ${nutrition.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          doc.fontSize(11).fillColor('#B8965A').text(meal.meal, 60);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fillColor('#2C2C2C').text(`  • ${opt}`, 70);
            }
          }
          if (meal.macros_approx) {
            doc.fontSize(8).fillColor('#6B6B6B').text(`    (${meal.macros_approx})`, 70);
          }
          doc.moveDown(0.3);
        }
      }

      doc.moveDown(0.5);
      if (nutrition.hydration) {
        doc.fontSize(10).fillColor('#2C2C2C').text(`Hydration: ${nutrition.hydration}`, 60);
      }
      if (nutrition.supplements?.length) {
        doc.fontSize(10).fillColor('#2C2C2C').text(`Supplements: ${nutrition.supplements.join(', ')}`, 60);
      }
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#6B6B6B')
      .text('This program is designed specifically for you by Fitness by Maddy. Do not share or redistribute.', 50, doc.y, { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;

    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    const targetWeek = week_no || (checkins?.length ? Math.max(...checkins.map(c => c.week_no)) + 1 : 1);

    const { data: existingProgram } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', targetWeek)
      .maybeSingle();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const programData = await generateWithClaude(client, checkins || []);

    const safety = checkSafety(programData);
    if (!safety.safe) {
      await notifyMaddy(
        `Program flagged: ${safety.flag}`,
        `Client: ${client.name}\nPhone: ${maskPhone(client.phone)}\nWeek: ${targetWeek}\nFlag: ${safety.flag}`
      );

      await db.from('programs').insert({
        client_id,
        week_no: targetWeek,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: `FLAGGED: ${safety.flag} — awaiting Maddy review`
      });

      return res.status(200).json({ ok: true, action: 'flagged_for_review', flag: safety.flag });
    }

    const pdfBuffer = await generatePDF(client, targetWeek, programData);

    const filePath = `clients/${client_id}/week_${targetWeek}.pdf`;
    const { error: uploadErr } = await db.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr);
    }

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no: targetWeek,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.context_note || null
    });

    const contextNote = programData.context_note || `Your Week ${targetWeek} program is ready!`;
    await sendTemplateForced(client.phone, 'weekly_program', [
      client.name || 'there',
      String(targetWeek),
      contextNote
    ]);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', targetWeek);

    return res.status(200).json({
      ok: true,
      week: targetWeek,
      pdf_url: pdfUrl
    });

  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
