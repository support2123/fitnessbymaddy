const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy, maskPhone } = require('../lib/escalation');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `You are Maddy's program architect — an expert fitness coach assistant for FitnessByMaddy.

You create weekly training and nutrition plans for clients based on their profile and recent check-in data.

RULES:
- Never prescribe extreme calorie cuts (minimum 1200 kcal for women, 1500 for men)
- Never recommend banned or dangerous supplements
- Never promise specific weight loss timelines
- Always include rest days (minimum 1-2 per week)
- Progressive overload: increase volume/intensity by 5-10% per week max
- If the client reports pain, injury, or medical concerns, flag for human review
- Adjust based on compliance score and energy levels from check-ins
- Keep language warm, professional, and motivating

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": "...",
    "rest_days": ["Saturday", "Sunday"]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "One-liner context for the client",
  "flagged": false,
  "flag_reason": null
}`;

async function generatePlan(client, checkins) {
  const lastTwo = checkins.slice(0, 2);
  const clientContext = {
    program: client.program,
    weeks_completed: lastTwo[0]?.week_no || 0,
    recent_checkins: lastTwo.map(c => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    })),
  };

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Generate Week ${(lastTwo[0]?.week_no || 0) + 1} program for this client:\n\n${JSON.stringify(clientContext, null, 2)}`,
      },
    ],
  });

  const text = message.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse Claude response as JSON');

  return JSON.parse(jsonMatch[0]);
}

function renderPDF(plan, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(11).fill('#999999').text(`Prepared for ${clientName || 'Client'}`, 50, 95);

    doc.moveDown(4);
    doc.fill('#2C2C2C');

    // Workout section
    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, 140);
    doc.moveTo(50, 162).lineTo(545, 162).stroke('#E8E3DC');

    let y = 175;
    if (plan.workout_plan && plan.workout_plan.days) {
      for (const day of plan.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#6B6B6B')
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || '60s'}`, 60, y);
            y += 16;
          }
        }
        y += 10;
      }
    }

    if (plan.workout_plan && plan.workout_plan.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fontSize(11).fill('#2C2C2C').text('Cardio:', 50, y);
      doc.fontSize(10).fill('#6B6B6B').text(plan.workout_plan.cardio, 110, y);
      y += 25;
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
    y += 25;
    doc.moveTo(50, y).lineTo(545, y).stroke('#E8E3DC');
    y += 15;

    if (plan.nutrition_plan) {
      const np = plan.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fats: ${np.fats_g}g`, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  — ${opt}`, 60, y);
              y += 14;
            }
          }
          y += 6;
        }
      }
    }

    // Footer
    if (y > 700) { doc.addPage(); y = 50; }
    y += 20;
    doc.moveTo(50, y).lineTo(545, y).stroke('#E8E3DC');
    y += 15;
    if (plan.notes) {
      doc.fontSize(10).fill('#B8965A').text(plan.notes, 50, y, { width: 495 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
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

    const plan = await generatePlan(client, checkins || []);

    if (plan.flagged) {
      await escalateToMaddy(
        'Program flagged by AI',
        `Client: ${client.name || maskPhone(client.phone)}\nReason: ${plan.flag_reason}`
      );
      return res.status(200).json({ flagged: true, reason: plan.flag_reason });
    }

    const safetyIssues = [];
    if (plan.nutrition_plan) {
      if (plan.nutrition_plan.calories < 1200) safetyIssues.push('Calories below 1200');
    }
    if (safetyIssues.length > 0) {
      await escalateToMaddy('Safety check failed', `Issues: ${safetyIssues.join(', ')}\nClient: ${client.name}`);
      return res.status(200).json({ flagged: true, reason: safetyIssues.join(', ') });
    }

    const pdfBuffer = await renderPDF(plan, client.name, week_no);

    const filePath = `${client.id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: plan.notes,
      })
      .select()
      .single();

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      plan.notes || 'Your new program is ready!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
