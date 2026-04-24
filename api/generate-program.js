const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { maskPhone, PROGRAM_NAMES } = require('../lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'starvation',
  'clenbuterol', 'dnp', 'steroids', 'anabolic',
  'lose 10kg in 1 week', 'extreme cut', 'water fast',
  'laxative', 'diuretic for weight',
];

function hasSafetyIssue(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some((f) => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

    const clientProfile = {
      name: client.name,
      age: client.age,
      goal: client.goal,
      injuries: client.injuries,
      diet_pref: client.diet_pref,
      schedule: client.schedule,
      program: client.program,
      week: week_no,
      total_weeks: 12,
    };

    const prompt = `You are a NASM-certified personal trainer and nutrition coach creating Week ${week_no} of a 12-week custom fitness program.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-INS (most recent first):
${recentCheckins && recentCheckins.length > 0 ? JSON.stringify(recentCheckins, null, 2) : 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM (if any):
${prevPrograms && prevPrograms.length > 0 ? JSON.stringify(prevPrograms[0], null, 2) : 'None — this is the first week'}

INSTRUCTIONS:
- Create a complete 7-day workout plan and daily nutrition plan
- Progressively overload from previous week if applicable
- Adjust based on check-in feedback (compliance, energy, issues)
- Be specific: sets, reps, rest periods, exact food quantities in grams
- Include warm-up and cool-down for each workout day
- If client reported pain/issues, modify exercises to accommodate
- Include 1-2 rest days
- Nutrition: provide exact macros (protein/carbs/fat) and calorie targets
- Meals should be practical and aligned with diet preference: ${client.diet_pref || 'flexible'}

RESPOND WITH VALID JSON ONLY — no markdown, no explanation:
{
  "workout_plan": {
    "overview": "Brief overview of this week's focus",
    "days": [
      {
        "day": 1,
        "name": "Day name (e.g., Upper Body Push)",
        "exercises": [
          { "name": "Exercise", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min description",
        "cooldown": "5 min description"
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "macros": { "protein_g": 150, "carbs_g": 200, "fat_g": 70 },
    "meals": [
      { "meal": "Breakfast", "items": "Description with quantities", "calories": 500 }
    ],
    "hydration": "Water intake recommendation",
    "supplements": "If any"
  },
  "coach_notes": "Brief motivational/strategic note for the client"
}`;

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].text;

    if (hasSafetyIssue(responseText)) {
      await sendText(MADDY_PHONE,
        `⚠️ SAFETY FLAG: Program for ${client.name || maskPhone(client.phone)} Week ${week_no} contains potentially unsafe content. Review manually before sending.`
      );
      await supabase.from('programs').insert({
        client_id,
        week_no,
        workout_plan: { flagged: true, raw: responseText },
        nutrition_plan: { flagged: true },
        notes: 'SAFETY FLAGGED — awaiting manual review',
      });
      return res.status(200).json({ ok: true, flagged: true });
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Claude response is not valid JSON');
      }
    }

    const pdfBuffer = await generatePDF(client, week_no, parsed);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('PDF upload error:', uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    const { data: program } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_notes,
      pdf_url: pdfUrl,
    }).select().single();

    const coachNote = parsed.coach_notes || `Week ${week_no} program is ready!`;
    await sendText(client.phone,
      `💪 Week ${week_no} Program Ready!\n\n${coachNote}\n\nYour full workout & nutrition plan has been sent. Check it out and let's crush this week!`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week=${week_no}`);
    return res.status(200).json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Program generation failed' });
  }
};

async function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(10)
      .font('Helvetica')
      .text('FITNESS BY MADDY', 50, 40, { characterSpacing: 4 });

    doc.fillColor('#ffffff')
      .fontSize(32)
      .font('Helvetica-Bold')
      .text(`WEEK ${weekNo}`, 50, 80);

    doc.fillColor('#B8965A')
      .fontSize(14)
      .font('Helvetica')
      .text(client.name ? `${client.name}'s Custom Program` : 'Your Custom Program', 50, 120);

    doc.fillColor('#B8965A').rect(50, 150, 495, 1).fill();

    let y = 170;

    if (plan.workout_plan) {
      doc.fillColor('#B8965A')
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('WORKOUT PLAN', 50, y);
      y += 25;

      if (plan.workout_plan.overview) {
        doc.fillColor('#cccccc')
          .fontSize(10)
          .font('Helvetica')
          .text(plan.workout_plan.overview, 50, y, { width: 495 });
        y += doc.heightOfString(plan.workout_plan.overview, { width: 495 }) + 15;
      }

      const days = plan.workout_plan.days || [];
      for (const day of days) {
        if (y > 700) {
          doc.addPage();
          doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
          y = 50;
        }

        doc.fillColor('#ffffff')
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`Day ${day.day}: ${day.name || ''}`, 50, y);
        y += 18;

        if (day.warmup) {
          doc.fillColor('#999999')
            .fontSize(9)
            .font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60, y, { width: 480 });
          y += doc.heightOfString(`Warm-up: ${day.warmup}`, { width: 480 }) + 6;
        }

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          if (y > 720) {
            doc.addPage();
            doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
            y = 50;
          }

          doc.fillColor('#e0e0e0')
            .fontSize(10)
            .font('Helvetica')
            .text(`→ ${ex.name}`, 65, y);

          doc.fillColor('#B8965A')
            .text(`${ex.sets}×${ex.reps} | Rest: ${ex.rest}`, 320, y, { width: 225, align: 'right' });
          y += 16;

          if (ex.notes) {
            doc.fillColor('#888888')
              .fontSize(8)
              .text(`   ${ex.notes}`, 75, y, { width: 460 });
            y += 12;
          }
        }

        if (day.cooldown) {
          doc.fillColor('#999999')
            .fontSize(9)
            .font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60, y, { width: 480 });
          y += doc.heightOfString(`Cool-down: ${day.cooldown}`, { width: 480 }) + 6;
        }

        y += 12;
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');
    y = 50;

    if (plan.nutrition_plan) {
      doc.fillColor('#B8965A')
        .fontSize(16)
        .font('Helvetica-Bold')
        .text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = plan.nutrition_plan;
      doc.fillColor('#ffffff')
        .fontSize(11)
        .font('Helvetica-Bold')
        .text(`Daily Target: ${np.daily_calories || '—'} kcal`, 50, y);
      y += 20;

      if (np.macros) {
        doc.fillColor('#B8965A')
          .fontSize(10)
          .font('Helvetica')
          .text(`Protein: ${np.macros.protein_g}g  |  Carbs: ${np.macros.carbs_g}g  |  Fat: ${np.macros.fat_g}g`, 50, y);
        y += 25;
      }

      doc.fillColor('#B8965A').rect(50, y, 495, 0.5).fill();
      y += 15;

      const meals = np.meals || [];
      for (const meal of meals) {
        doc.fillColor('#ffffff')
          .fontSize(11)
          .font('Helvetica-Bold')
          .text(meal.meal, 50, y);

        doc.fillColor('#B8965A')
          .fontSize(9)
          .text(`${meal.calories || '—'} kcal`, 420, y, { width: 125, align: 'right' });
        y += 16;

        doc.fillColor('#cccccc')
          .fontSize(9)
          .font('Helvetica')
          .text(meal.items, 60, y, { width: 480 });
        y += doc.heightOfString(meal.items, { width: 480 }) + 12;
      }

      if (np.hydration) {
        y += 10;
        doc.fillColor('#999999')
          .fontSize(9)
          .text(`💧 Hydration: ${np.hydration}`, 50, y, { width: 495 });
        y += 16;
      }

      if (np.supplements) {
        doc.fillColor('#999999')
          .fontSize(9)
          .text(`💊 Supplements: ${np.supplements}`, 50, y, { width: 495 });
      }
    }

    doc.addPage();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#1a1a1a');

    doc.fillColor('#B8965A')
      .fontSize(10)
      .font('Helvetica')
      .text('FITNESS BY MADDY', 50, 350, { width: 495, align: 'center', characterSpacing: 6 });

    doc.fillColor('#ffffff')
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('Trust the process.', 50, 380, { width: 495, align: 'center' });

    doc.fillColor('#888888')
      .fontSize(9)
      .font('Helvetica')
      .text('www.fitnessbymaddy.com | @fitnessbymaddy_', 50, 420, { width: 495, align: 'center' });

    doc.end();
  });
}
