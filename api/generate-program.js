const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const BANNED_TERMS = [
  'dnp', 'clenbuterol', 'steroids', 'anavar', 'trenbolone',
  'sarms', 'hgh injection', 'testosterone injection',
  'below 1000 calories', 'below 800 calories', '500 calorie',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client_not_found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, notes, workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic();

    const systemPrompt = `You are a NASM-certified fitness program architect working for Fitness by Maddy.
You create weekly personalised workout and nutrition plans for clients.

RULES:
- Never recommend banned substances, extreme calorie restriction (<1200 cal/day for women, <1500 for men), or unrealistic timelines
- Base recommendations on check-in data: compliance, energy, weight trends, reported issues
- Progressive overload: increase volume/intensity by 5-10% per week max
- Include rest days (minimum 1-2 per week)
- Nutrition must be sustainable and culturally appropriate
- Output ONLY valid JSON with the exact schema specified`;

    const userPrompt = `Create Week ${week_no} program for this client:

CLIENT PROFILE:
- Program: ${client.program}
- Started: ${client.program_started_at}
- Name: ${client.name || 'Client'}

RECENT CHECK-INS (most recent first):
${JSON.stringify(recentCheckins || [], null, 2)}

PREVIOUS PROGRAM:
${JSON.stringify(prevPrograms?.[0] || 'None (first week)', null, 2)}

Return JSON with this exact schema:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min LISS on incline treadmill"
      }
    ],
    "deload": false,
    "weekly_volume_note": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 165,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Meal 1", "time": "8:00 AM", "items": ["4 eggs scrambled", "2 toast", "1 banana"], "calories": 550 }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"],
    "notes": ""
  },
  "coach_note": "Short motivational/context note for WhatsApp delivery"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await escalateToMaddy('Program generation returned invalid JSON', {
        phone: maskPhone(client.phone),
        detail: `Client ${client_id}, week ${week_no}`,
      });
      return res.status(500).json({ error: 'invalid_ai_response' });
    }

    const plan = JSON.parse(jsonMatch[0]);
    const planStr = JSON.stringify(plan).toLowerCase();

    for (const term of BANNED_TERMS) {
      if (planStr.includes(term)) {
        await escalateToMaddy('Program contains flagged content', {
          phone: maskPhone(client.phone),
          detail: `Flagged term: "${term}" in week ${week_no} plan for client ${client_id}`,
        });
        return res.status(422).json({ error: 'flagged_content', term });
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, plan);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url || 'clients/' + client_id}/${fileName}`;

    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadError) {
      const { data: urlData } = db.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl || null;
    }

    const { data: programRecord, error: insertError } = await db
      .from('programs')
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: plan.coach_note || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('program insert error:', insertError.message);
      return res.status(500).json({ error: 'db_error' });
    }

    if (pdfUrl) {
      await sendTemplate(client.phone, 'weekly_program', [
        client.name || 'there',
        String(week_no),
        plan.coach_note || `Your Week ${week_no} program is ready!`,
        pdfUrl,
      ]);

      await db
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', programRecord.id);
    }

    return res.json({
      success: true,
      program_id: programRecord.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const GOLD = '#B8965A';
    const CHARCOAL = '#2C2C2C';

    doc
      .rect(0, 0, doc.page.width, 120)
      .fill(CHARCOAL);

    doc
      .fontSize(10)
      .fillColor(GOLD)
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });

    doc
      .fontSize(28)
      .fillColor('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 58);

    doc
      .fontSize(10)
      .fillColor('#999999')
      .text(`${client.name || 'Client'} | ${client.program.toUpperCase()}`, 50, 95);

    let y = 145;

    if (plan.workout_plan && plan.workout_plan.days) {
      doc
        .fontSize(14)
        .fillColor(GOLD)
        .text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
      y += 25;

      doc.moveTo(50, y).lineTo(545, y).strokeColor('#E8E3DC').stroke();
      y += 15;

      for (const day of plan.workout_plan.days) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }

        doc
          .fontSize(12)
          .fillColor(CHARCOAL)
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc
              .fontSize(9)
              .fillColor('#6B6B6B')
              .text(
                `  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`,
                60,
                y
              );
            y += 15;
          }
        }

        if (day.cardio) {
          doc
            .fontSize(9)
            .fillColor(GOLD)
            .text(`  Cardio: ${day.cardio}`, 60, y);
          y += 15;
        }

        y += 10;
      }
    }

    if (plan.nutrition_plan) {
      if (y > 600) {
        doc.addPage();
        y = 50;
      }

      y += 10;
      doc
        .fontSize(14)
        .fillColor(GOLD)
        .text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
      y += 25;

      doc.moveTo(50, y).lineTo(545, y).strokeColor('#E8E3DC').stroke();
      y += 15;

      const np = plan.nutrition_plan;
      doc
        .fontSize(10)
        .fillColor(CHARCOAL)
        .text(
          `Daily Targets: ${np.calories} cal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`,
          50,
          y
        );
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 700) {
            doc.addPage();
            y = 50;
          }

          doc
            .fontSize(10)
            .fillColor(CHARCOAL)
            .text(`${meal.meal} (${meal.time}) — ${meal.calories} cal`, 50, y);
          y += 16;

          if (meal.items) {
            for (const item of meal.items) {
              doc
                .fontSize(9)
                .fillColor('#6B6B6B')
                .text(`  • ${item}`, 60, y);
              y += 13;
            }
          }
          y += 8;
        }
      }

      if (np.hydration) {
        doc.fontSize(9).fillColor('#6B6B6B').text(`Hydration: ${np.hydration}`, 50, y);
        y += 15;
      }

      if (np.supplements && np.supplements.length > 0) {
        doc
          .fontSize(9)
          .fillColor('#6B6B6B')
          .text(`Supplements: ${np.supplements.join(', ')}`, 50, y);
        y += 15;
      }
    }

    if (plan.coach_note) {
      if (y > 680) {
        doc.addPage();
        y = 50;
      }
      y += 20;
      doc
        .rect(50, y, 495, 50)
        .fill('#FAF8F4');
      doc
        .fontSize(9)
        .fillColor(GOLD)
        .text('COACH NOTE', 65, y + 10, { characterSpacing: 2 });
      doc
        .fontSize(10)
        .fillColor(CHARCOAL)
        .text(plan.coach_note, 65, y + 25, { width: 465 });
    }

    doc.end();
  });
}
