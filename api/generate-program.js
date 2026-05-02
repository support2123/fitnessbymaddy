const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglish } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');

const SAFETY_FLAGS = [
  'under 1000 calories', 'under 800 calories', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme cut', 'water fasting for weeks'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*, leads(market, name)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: previousProgram } = await db
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const clientContext = {
      name: client.name || 'Client',
      program: client.program,
      week: week_no,
      recentCheckins: recentCheckins || [],
      previousPlan: previousProgram || null
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect for FitnessByMaddy, an elite online coaching brand. You design weekly workout and nutrition plans for clients based on their check-in data and progress.

RULES:
- Be evidence-based. No bro-science.
- Never recommend fewer than 1200 calories/day for women or 1500 for men.
- Never recommend banned substances, steroids, or extreme protocols.
- Always include warm-up and cool-down in workouts.
- Progressive overload: increase volume/intensity gradually.
- Adjust based on compliance score and energy levels from check-ins.
- If energy is low (1-4), reduce volume by 20% and add a deload suggestion.
- Output must be valid JSON with "workout_plan" and "nutrition_plan" keys.

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ], "warmup": "5 min light cardio + dynamic stretching", "cooldown": "5 min static stretching" }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "weekly_notes": ""
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "", "protein_g": 40 }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Multivitamin"],
    "notes": ""
  },
  "context_note": "One-liner summary for WhatsApp message"
}`;

    const userPrompt = `Generate Week ${week_no} program for:
Client: ${clientContext.name}
Program type: ${clientContext.program}

Recent check-in data:
${JSON.stringify(clientContext.recentCheckins, null, 2)}

Previous week's plan summary:
${clientContext.previousPlan ? JSON.stringify(clientContext.previousPlan, null, 2) : 'First week - no previous plan'}

Design the optimal next week based on this data.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Claude response');

    const programData = JSON.parse(jsonMatch[0]);

    const responseCheck = JSON.stringify(programData).toLowerCase();
    const flagged = SAFETY_FLAGS.some(flag => responseCheck.includes(flag));
    if (flagged) {
      await escalateToMaddy({
        reason: 'program_safety_flag',
        phone: client.phone,
        message: `Week ${week_no} program flagged for safety review. Auto-send halted.`
      });
      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED: Awaiting Maddy review',
        pdf_url: null
      });
      return res.status(200).json({ success: true, flagged: true });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const fileName = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('programs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = db.storage
      .from('programs')
      .getPublicUrl(fileName);

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.context_note || '',
      pdf_url: publicUrl.publicUrl
    }).select().single();

    const market = client.leads?.market || 'GLOBAL';
    const hinglish = isHinglish(market);
    const contextNote = programData.context_note || `Week ${week_no} program ready`;

    const msg = hinglish
      ? `Week ${week_no} ka program ready hai! ${contextNote}\nPDF: ${publicUrl.publicUrl}`
      : `Your Week ${week_no} program is ready! ${contextNote}\nPDF: ${publicUrl.publicUrl}`;

    await sendWhatsApp({
      phone: client.phone,
      body: msg
    });

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const gold = '#B8965A';
    const charcoal = '#2C2C2C';

    doc.rect(0, 0, doc.page.width, 120).fill(charcoal);
    doc.fontSize(28).fill('#FFFFFF').text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fontSize(14).fill(gold).text(`WEEK ${weekNo} PROGRAM`, 50, 72, { align: 'left' });
    doc.fontSize(10).fill('#999999').text(`Prepared for ${client.name || 'Client'}`, 50, 95, { align: 'left' });

    doc.fill(charcoal);
    let y = 145;

    if (programData.workout_plan && programData.workout_plan.days) {
      doc.fontSize(18).fill(gold).text('WORKOUT PLAN', 50, y);
      y += 30;

      if (programData.workout_plan.weekly_notes) {
        doc.fontSize(9).fill('#666666').text(programData.workout_plan.weekly_notes, 50, y, { width: 500 });
        y += 20;
      }

      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill(charcoal).text(`${day.day} — ${day.focus}`, 50, y);
        y += 18;

        if (day.warmup) {
          doc.fontSize(8).fill('#999999').text(`Warm-up: ${day.warmup}`, 60, y);
          y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(charcoal).text(
              `${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`,
              70, y
            );
            y += 14;
            if (ex.notes) {
              doc.fontSize(8).fill('#999999').text(ex.notes, 80, y);
              y += 12;
            }
          }
        }

        if (day.cooldown) {
          doc.fontSize(8).fill('#999999').text(`Cool-down: ${day.cooldown}`, 60, y);
          y += 14;
        }

        y += 10;
      }

      if (programData.workout_plan.rest_days) {
        doc.fontSize(9).fill('#999999').text(
          `Rest Days: ${programData.workout_plan.rest_days.join(', ')}`, 50, y
        );
        y += 20;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill(gold).text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = programData.nutrition_plan;
      doc.fontSize(11).fill(charcoal);
      doc.text(`Daily Calories: ${np.calories} kcal`, 50, y); y += 16;
      doc.text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50, y); y += 20;

      if (np.meal_framework) {
        for (const meal of np.meal_framework) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(charcoal).text(`${meal.meal}: ${meal.suggestion}`, 60, y);
          y += 14;
          if (meal.protein_g) {
            doc.fontSize(8).fill('#999999').text(`Protein target: ${meal.protein_g}g`, 70, y);
            y += 12;
          }
        }
        y += 8;
      }

      if (np.hydration) {
        doc.fontSize(9).fill('#666666').text(`Hydration: ${np.hydration}`, 50, y);
        y += 14;
      }
      if (np.supplements && np.supplements.length > 0) {
        doc.fontSize(9).fill('#666666').text(`Supplements: ${np.supplements.join(', ')}`, 50, y);
        y += 14;
      }
      if (np.notes) {
        doc.fontSize(9).fill('#666666').text(np.notes, 50, y, { width: 500 });
        y += 20;
      }
    }

    const footerY = doc.page.height - 40;
    doc.fontSize(8).fill('#CCCCCC').text(
      'FitnessByMaddy | fitnessbymaddy.com | @fitnessbymaddy_',
      50, footerY, { align: 'center', width: doc.page.width - 100 }
    );

    doc.end();
  });
}
