const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const SAFETY_BLOCKLIST = [
  'dnp', 'clenbuterol', 'steroids', 'anabolic', 'sarms',
  'under 800 calories', 'under 900 calories', 'under 1000 calories',
  'extreme deficit', 'water fast', 'dry fast',
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert NASM-certified personal trainer and nutrition coach. Generate a weekly training and nutrition plan for a client.

Output ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meal_timing": "...",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_note": "..."
}

Rules:
- Never recommend banned substances, extreme calorie cuts (under 1200 for women, 1500 for men), or unrealistic timelines
- Adjust based on check-in compliance, energy levels, and reported issues
- Be progressive: increase intensity/volume appropriately week over week
- Account for injuries and diet preferences
- Keep language warm, motivating, and professional`;

    const userPrompt = `Client Profile:
- Name: ${client.name || 'Client'}
- Age: ${client.age || 'Unknown'}
- Program: ${client.program}
- Goal: ${client.goal || 'General fitness'}
- Injuries: ${client.injuries || 'None reported'}
- Diet Preference: ${client.diet_pref || 'No restriction'}
- Schedule: ${client.schedule || 'Flexible'}
- Week: ${week_no}

${recentCheckins && recentCheckins.length > 0 ? `Recent Check-ins:
${recentCheckins.map((c) => `  Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')}` : 'No previous check-ins (first week).'}

${prevPrograms && prevPrograms.length > 0 ? `Previous Week Plan Notes: ${prevPrograms[0].notes || 'None'}` : ''}

Generate the Week ${week_no} program.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const outputStr = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_BLOCKLIST.some((term) => outputStr.includes(term));
    if (flagged) {
      const { sendTemplate: notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy('917082478374', 'escalation_alert', [
        'unsafe_program_content',
        client.phone ? client.phone.slice(0, 3) + 'XXX...' + client.phone.slice(-3) : 'unknown',
        `Week ${week_no} program flagged for safety review`,
      ]);
      return res.status(200).json({ action: 'flagged_for_review', week_no });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    const { data: program } = await db
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        pdf_url: publicUrl.publicUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.weekly_note,
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'Champion',
      `Week ${week_no}`,
      programData.weekly_note ? programData.weekly_note.substring(0, 200) : 'Your new program is ready!',
    ]);

    await db
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      generated: true,
      program_id: program.id,
      pdf_url: publicUrl.publicUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

async function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 50, { align: 'center' });

    doc.fill('#ffffff').fontSize(18).font('Helvetica')
      .text(`Week ${weekNo} Program`, 50, 90, { align: 'center' });

    doc.fill('#B8965A').fontSize(12)
      .text(`${client.name || 'Client'} | ${client.program || 'Custom'}`, 50, 115, { align: 'center' });

    doc.moveTo(50, 145).lineTo(doc.page.width - 50, 145).stroke('#B8965A');

    let y = 165;

    if (programData.workout_plan && programData.workout_plan.days) {
      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold').text('WORKOUT PLAN', 50, y);
      y += 30;

      for (const day of programData.workout_plan.days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) {
              doc.addPage();
              doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
              y = 50;
            }
            doc.fill('#ffffff').fontSize(10).font('Helvetica')
              .text(`  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60, y);
            y += 16;
            if (ex.notes) {
              doc.fill('#888888').fontSize(9).text(`    ${ex.notes}`, 70, y);
              y += 14;
            }
          }
        }
        y += 10;
      }

      if (programData.workout_plan.cardio) {
        doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text('Cardio:', 50, y);
        y += 16;
        doc.fill('#ffffff').fontSize(10).font('Helvetica').text(programData.workout_plan.cardio, 60, y, { width: 480 });
        y += 30;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }

      doc.fill('#B8965A').fontSize(16).font('Helvetica-Bold').text('NUTRITION PLAN', 50, y);
      y += 25;

      const np = programData.nutrition_plan;
      doc.fill('#ffffff').fontSize(11).font('Helvetica');

      if (np.calories) {
        doc.text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fats: ${np.fats_g}g`, 50, y, { width: 500 });
        y += 22;
      }

      if (np.meal_timing) {
        doc.fill('#888888').fontSize(10).text(`Timing: ${np.meal_timing}`, 50, y, { width: 500 });
        y += 20;
      }

      if (np.sample_meals) {
        for (const meal of np.sample_meals) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
            y = 50;
          }
          doc.fill('#B8965A').fontSize(11).font('Helvetica-Bold').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fill('#ffffff').fontSize(10).font('Helvetica').text(`  • ${opt}`, 60, y, { width: 470 });
              y += 15;
            }
          }
          y += 5;
        }
      }

      if (np.hydration) {
        doc.fill('#888888').fontSize(10).text(`Hydration: ${np.hydration}`, 50, y, { width: 500 });
        y += 20;
      }
    }

    if (programData.weekly_note) {
      if (y > 680) {
        doc.addPage();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
        y = 50;
      }
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#B8965A');
      y += 15;
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text("COACH'S NOTE", 50, y);
      y += 18;
      doc.fill('#ffffff').fontSize(10).font('Helvetica')
        .text(programData.weekly_note, 50, y, { width: 500 });
    }

    doc.end();
  });
}
