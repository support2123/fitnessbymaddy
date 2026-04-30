const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { isHinglishMarket } = require('./lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { data: intake } = await db
      .from('intake_data')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

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
      .eq('week_no', week_no - 1)
      .single();

    const programData = await generateWithClaude({
      client, intake, recentCheckins, prevProgram, week_no
    });

    if (programData.flagged) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy({
        reason: `Program generation flagged: ${programData.flagReason}`,
        phone: client.phone,
        clientName: client.name,
        messageText: `Week ${week_no} program flagged for review`
      });
      return res.status(200).json({ status: 'flagged', reason: programData.flagReason });
    }

    const pdfBuffer = await generatePDF({
      clientName: client.name,
      weekNo: week_no,
      workout: programData.workout_plan,
      nutrition: programData.nutrition_plan,
      notes: programData.notes
    });

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

    const { data: urlData } = db.storage
      .from('client-files')
      .getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
      whatsapp_sent_at: null
    });

    const { data: lead } = client.lead_id
      ? await db.from('leads').select('market').eq('id', client.lead_id).single()
      : { data: null };
    const hinglish = isHinglishMarket(lead?.market || 'GLOBAL');

    const contextNote = programData.notes || `Week ${week_no} program ready`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: hinglish
        ? `${client.name}, tumhara Week ${week_no} ka program ready hai! 💪\n\n${contextNote}\n\nPDF: ${pdfUrl}`
        : `${client.name}, your Week ${week_no} program is ready! 💪\n\n${contextNote}\n\nPDF: ${pdfUrl}`,
      params: {
        name: client.name,
        templateParams: [client.name, `${week_no}`, pdfUrl]
      }
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude({ client, intake, recentCheckins, prevProgram, week_no }) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const systemPrompt = `You are a certified fitness program architect for Fitness by Maddy. You design personalized weekly workout and nutrition plans.

RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances or supplements beyond basics (whey, creatine, multivitamin)
- Never promise specific weight loss timelines
- Workouts must be progressive — build on previous week
- Nutrition must be practical and sustainable
- If anything seems medically risky, set "flagged": true and explain in "flagReason"

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]}
    ],
    "cardio": "3x 20min LISS or 2x 15min HIIT",
    "steps_target": 8000
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "hydration": "3L minimum",
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"]
  },
  "notes": "One-liner context for WhatsApp message",
  "flagged": false,
  "flagReason": ""
}`;

  const userPrompt = buildUserPrompt({ client, intake, recentCheckins, prevProgram, week_no });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const parsed = JSON.parse(jsonMatch[0]);

  if (parsed.nutrition_plan?.calories) {
    const cal = parsed.nutrition_plan.calories;
    const gender = intake?.gender?.toLowerCase();
    if ((gender === 'female' && cal < 1200) || (gender === 'male' && cal < 1500) || cal < 1200) {
      return {
        ...parsed,
        flagged: true,
        flagReason: `Calories too low: ${cal}kcal for ${gender || 'unknown'} client`
      };
    }
  }

  return parsed;
}

function buildUserPrompt({ client, intake, recentCheckins, prevProgram, week_no }) {
  let prompt = `Generate Week ${week_no} program for:\n\n`;
  prompt += `CLIENT: ${client.name}\n`;
  prompt += `Program: ${client.program}\n`;

  if (intake) {
    prompt += `Age: ${intake.age || 'unknown'}\n`;
    prompt += `Gender: ${intake.gender || 'unknown'}\n`;
    prompt += `Goal: ${intake.goal || 'general fitness'}\n`;
    prompt += `Injuries: ${intake.injuries || 'none'}\n`;
    prompt += `Diet preference: ${intake.diet_preference || 'no preference'}\n`;
    prompt += `Experience: ${intake.workout_experience || 'beginner'}\n`;
    prompt += `Equipment: ${intake.equipment_access || 'full gym'}\n`;
    prompt += `Schedule: ${intake.schedule || 'flexible'}\n`;
  }

  if (recentCheckins && recentCheckins.length > 0) {
    prompt += `\nRECENT CHECK-INS:\n`;
    for (const c of recentCheckins) {
      prompt += `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10`;
      if (c.issues) prompt += `, Issues: ${c.issues}`;
      prompt += '\n';
    }
  }

  if (prevProgram) {
    prompt += `\nPREVIOUS WEEK PLAN SUMMARY:\n`;
    prompt += `Workout: ${JSON.stringify(prevProgram.workout_plan).substring(0, 500)}\n`;
    prompt += `Nutrition: ${JSON.stringify(prevProgram.nutrition_plan).substring(0, 300)}\n`;
  }

  prompt += `\nDesign Week ${week_no} with appropriate progression. Return JSON only.`;
  return prompt;
}

async function generatePDF({ clientName, weekNo, workout, nutrition, notes }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill(gold).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75);
    doc.fontSize(10).fill('#CCCCCC')
      .text(`Prepared for ${clientName}`, 50, 95);

    doc.moveDown(4);
    let y = 150;

    doc.fontSize(18).fill(gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, y);
    y += 30;

    if (workout?.days) {
      for (const day of workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill(charcoal).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill('#444444').font('Helvetica')
              .text(`  •  ${ex.name}  |  ${ex.sets} × ${ex.reps}  |  Rest: ${ex.rest}`, 60, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(9).fill('#888888')
                .text(`     ${ex.notes}`, 70, y);
              y += 14;
            }
          }
        }
        y += 10;
      }
    }

    if (workout?.cardio) {
      y += 5;
      doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
        .text(`Cardio: `, 50, y, { continued: true })
        .font('Helvetica').fill('#444444')
        .text(workout.cardio);
      y += 18;
    }

    if (workout?.steps_target) {
      doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
        .text(`Daily Steps Target: `, 50, y, { continued: true })
        .font('Helvetica').fill('#444444')
        .text(`${workout.steps_target.toLocaleString()}`);
      y += 25;
    }

    if (y > 600) { doc.addPage(); y = 50; }

    doc.fontSize(18).fill(gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, y);
    y += 30;

    if (nutrition) {
      doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
        .text('Daily Targets', 50, y);
      y += 18;
      doc.fontSize(10).fill('#444444').font('Helvetica')
        .text(`Calories: ${nutrition.calories}kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`, 60, y);
      y += 25;

      if (nutrition.meals) {
        for (const meal of nutrition.meals) {
          if (y > 700) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(charcoal).font('Helvetica-Bold')
            .text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#444444').font('Helvetica')
                .text(`  •  ${opt}`, 60, y);
              y += 14;
            }
          }
          y += 8;
        }
      }

      if (nutrition.hydration) {
        y += 5;
        doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
          .text(`Hydration: `, 50, y, { continued: true })
          .font('Helvetica').fill('#444444')
          .text(nutrition.hydration);
        y += 18;
      }

      if (nutrition.supplements?.length) {
        doc.fontSize(10).fill(charcoal).font('Helvetica-Bold')
          .text(`Supplements:`, 50, y);
        y += 16;
        for (const s of nutrition.supplements) {
          doc.fontSize(10).fill('#444444').font('Helvetica')
            .text(`  •  ${s}`, 60, y);
          y += 14;
        }
      }
    }

    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(charcoal);
    doc.fontSize(8).fill('#888888')
      .text('fitnessbymaddy.com  |  Personalised coaching by Maddy', 50, doc.page.height - 28);

    doc.end();
  });
}
