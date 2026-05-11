const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000', 'below 800',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy.
Generate a weekly workout and nutrition plan for a client.
Output valid JSON only with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "LISS", "duration": "30min", "frequency": "3x/week" }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 160,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "suggestion": "...", "macros": "P30 C40 F15" },
      ...
    ],
    "supplements": ["whey protein", "creatine"],
    "hydration": "3L/day"
  },
  "coach_note": "One sentence motivational note for the client"
}
Rules:
- Never suggest calories below 1200 for women or 1500 for men
- Never recommend banned substances, SARMs, or steroids
- Keep timelines realistic (0.5-1kg fat loss per week max)
- Adapt based on check-in data (compliance, energy, issues)
- If client reports pain/injury, reduce intensity and flag for coach review`;

    const userPrompt = `Client: ${client.name || 'Client'}
Program: ${client.program}
Week: ${week_no}

Recent check-ins:
${JSON.stringify(recentCheckins || [], null, 2)}

Previous week program:
${JSON.stringify(prevProgram || 'First week - no previous program', null, 2)}

Generate Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const contentStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => contentStr.includes(f));
    if (flagged) {
      const { sendEscalation } = require('./_lib/whatsapp');
      await sendEscalation(
        `SAFETY FLAG: Program for ${client.name} (week ${week_no}) contains risky content. Review needed.`
      );
      return res.json({ ok: false, reason: 'safety_flagged', client_id });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `${client.id}/week_${week_no}.pdf`;
    await db.storage.from('clients').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    const { error: insertErr } = await db.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note,
    }, { onConflict: 'client_id,week_no' });

    if (insertErr) {
      console.error('Program insert error:', insertErr.message);
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const coachNote = programData.coach_note || 'Your new week plan is ready!';

    await sendWhatsApp({
      phone: client.phone,
      templateName: hinglish ? 'program_ready_hi' : 'program_ready',
      params: [client.name || 'there', String(week_no), coachNote],
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ ok: true, client_id, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
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
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fill('#FFFFFF').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 70);
    doc.fill('#D4AF7A').fontSize(11)
      .text(`${client.name || 'Client'} | ${client.program}`, 50, 90);

    doc.moveDown(4);

    doc.fill('#2C2C2C').fontSize(18).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    const workout = data.workout_plan;
    if (workout && workout.days) {
      for (const day of workout.days) {
        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
              .text(
                `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}` +
                (ex.notes ? `  |  ${ex.notes}` : ''),
                60
              );
          }
        }
        doc.moveDown(0.5);
      }

      if (workout.cardio) {
        doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
          .text('Cardio', 50);
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(
            `  ${workout.cardio.type} | ${workout.cardio.duration} | ${workout.cardio.frequency}`,
            60
          );
        doc.moveDown(1);
      }
    }

    doc.addPage();

    doc.rect(0, 0, doc.page.width, 50).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(14).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, 18);

    doc.moveDown(3);

    const nutrition = data.nutrition_plan;
    if (nutrition) {
      doc.fill('#2C2C2C').fontSize(12).font('Helvetica-Bold')
        .text('Daily Targets', 50);
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica')
        .text(`  Calories: ${nutrition.calories} kcal`, 60)
        .text(`  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`, 60)
        .text(`  Hydration: ${nutrition.hydration || '3L/day'}`, 60);
      doc.moveDown(1);

      if (nutrition.meals) {
        doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold')
          .text('Meals', 50);
        doc.moveDown(0.3);

        for (const meal of nutrition.meals) {
          doc.fill('#2C2C2C').fontSize(10).font('Helvetica-Bold')
            .text(`  ${meal.meal}`, 60);
          doc.font('Helvetica')
            .text(`    ${meal.suggestion}  (${meal.macros})`, 70);
          doc.moveDown(0.3);
        }
      }

      if (nutrition.supplements && nutrition.supplements.length > 0) {
        doc.moveDown(0.5);
        doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold')
          .text('Supplements', 50);
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica')
          .text(`  ${nutrition.supplements.join(', ')}`, 60);
      }
    }

    if (data.coach_note) {
      doc.moveDown(2);
      doc.rect(50, doc.y, doc.page.width - 100, 50).fill('#FAF8F4');
      doc.fill('#B8965A').fontSize(10).font('Helvetica-BoldOblique')
        .text(`"${data.coach_note}"`, 60, doc.y - 40, {
          width: doc.page.width - 120,
          align: 'center',
        });
    }

    const bottomY = doc.page.height - 40;
    doc.fill('#999').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is personalised — do not share.', 50, bottomY, {
        width: doc.page.width - 100,
        align: 'center',
      });

    doc.end();
  });
}
