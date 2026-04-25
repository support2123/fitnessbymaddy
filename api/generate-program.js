const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');
const { detectMarket, isHinglish } = require('./_lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'steroids', 'anabolic', 'sarms',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'water fast for', 'dry fast'
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase.from('clients')
      .select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await supabase.from('checkins')
      .select('*').eq('client_id', client_id)
      .order('week_no', { ascending: false }).limit(2);

    const { data: prevPrograms } = await supabase.from('programs')
      .select('workout_plan, nutrition_plan, week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false }).limit(1);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const prompt = buildPrompt(client, checkins || [], prevPrograms?.[0], week_no);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;

    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
      await notifyMaddy(supabase, sendTemplate,
        { name: client.name, phone: client.phone },
        `Program generation failed for week ${week_no} — could not parse Claude response`
      );
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    const programData = JSON.parse(jsonMatch[1]);

    const safetyCheck = checkSafety(JSON.stringify(programData));
    if (safetyCheck.flagged) {
      await notifyMaddy(supabase, sendTemplate,
        { name: client.name, phone: client.phone },
        `Program HALTED week ${week_no} — safety flags: ${safetyCheck.flags.join(', ')}`
      );
      return res.status(200).json({ halted: true, flags: safetyCheck.flags });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf', upsert: true
    });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await supabase.from('programs').insert({
      client_id, week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null
    });

    const market = detectMarket(client.phone);
    const tpl = isHinglish(market) ? 'program_ready_hi' : 'program_ready';
    await sendTemplate(client.phone, tpl, [
      client.name || 'there',
      String(week_no),
      programData.notes || 'Your new program is ready!'
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id).eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, checkins, prevProgram, weekNo) {
  const lastCheckin = checkins[0];
  const prevCheckin = checkins[1];

  return `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand.

Generate a week ${weekNo} program for this client. Return ONLY a JSON code block.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Week: ${weekNo} of ${client.program === '12wk' ? 12 : 6}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight}kg
- Waist: ${lastCheckin.waist}cm
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || 'None'}` : 'No check-in data yet.'}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight}kg
- Waist: ${prevCheckin.waist}cm
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ''}

${prevProgram ? `PREVIOUS PROGRAM (Week ${prevProgram.week_no}):
${JSON.stringify(prevProgram.workout_plan, null, 2)}` : ''}

RULES:
- Progressive overload from previous week
- 4-5 training days, 1-2 rest days
- Realistic calorie targets (never below 1200 for women, 1500 for men)
- No banned substances or extreme protocols
- Include warm-up and cool-down notes

Return this exact JSON structure:
\`\`\`json
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "5 min incline walk + band pull-aparts",
        "exercises": [
          { "name": "Barbell Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cooldown": "5 min stretching"
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "weekly_cardio": "3x 20min LISS or 2x 15min HIIT"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 75,
    "meal_timing": [
      { "meal": "Pre-workout", "time": "7:00 AM", "example": "Oats + banana + whey" }
    ],
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"],
    "hydration": "3-4 litres per day"
  },
  "notes": "One-liner context for the WhatsApp message"
}
\`\`\``;
}

function checkSafety(text) {
  const lower = text.toLowerCase();
  const flags = SAFETY_FLAGS.filter(f => lower.includes(f));
  return { flagged: flags.length > 0, flags };
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const GOLD = '#B8965A';
    const CHARCOAL = '#2C2C2C';

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fill('#FFFFFF').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fill(GOLD).fontSize(12).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });
    doc.fill('rgba(255,255,255,0.6)').fontSize(10)
      .text(`Prepared for ${client.name || 'Client'}`, 50, 95);

    doc.y = 140;

    // Workout Plan
    doc.fill(GOLD).fontSize(14).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.y += 25;

    if (programData.workout_plan?.days) {
      for (const day of programData.workout_plan.days) {
        if (doc.y > 680) { doc.addPage(); doc.y = 50; }

        doc.fill(CHARCOAL).fontSize(12).font('Helvetica-Bold')
          .text(`${day.day} — ${day.focus}`, 50, doc.y);
        doc.y += 18;

        if (day.warmup) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60, doc.y);
          doc.y += 14;
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (doc.y > 700) { doc.addPage(); doc.y = 50; }
            doc.fill(CHARCOAL).fontSize(10).font('Helvetica')
              .text(`• ${ex.name}`, 60, doc.y);
            doc.fill('#6B6B6B').fontSize(9)
              .text(`${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' | ' + ex.notes : ''}`, 75, doc.y + 13);
            doc.y += 28;
          }
        }

        if (day.cooldown) {
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60, doc.y);
          doc.y += 14;
        }

        doc.y += 10;
      }
    }

    if (programData.workout_plan?.weekly_cardio) {
      if (doc.y > 700) { doc.addPage(); doc.y = 50; }
      doc.fill(CHARCOAL).fontSize(10).font('Helvetica-Bold')
        .text(`Cardio: ${programData.workout_plan.weekly_cardio}`, 50, doc.y);
      doc.y += 25;
    }

    // Nutrition Plan
    if (doc.y > 600) { doc.addPage(); doc.y = 50; }

    doc.fill(GOLD).fontSize(14).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, doc.y, { characterSpacing: 2 });
    doc.y += 25;

    const np = programData.nutrition_plan;
    if (np) {
      doc.fill(CHARCOAL).fontSize(11).font('Helvetica-Bold')
        .text(`Daily Targets: ${np.calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`, 50, doc.y);
      doc.y += 22;

      if (np.meal_timing) {
        for (const meal of np.meal_timing) {
          if (doc.y > 700) { doc.addPage(); doc.y = 50; }
          doc.fill(CHARCOAL).fontSize(10).font('Helvetica-Bold')
            .text(`${meal.meal} (${meal.time})`, 60, doc.y);
          doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
            .text(meal.example, 60, doc.y + 13);
          doc.y += 28;
        }
      }

      if (np.supplements?.length) {
        doc.y += 5;
        doc.fill(CHARCOAL).fontSize(10).font('Helvetica-Bold')
          .text('Supplements:', 50, doc.y);
        doc.fill('#6B6B6B').fontSize(9).font('Helvetica')
          .text(np.supplements.join(' | '), 60, doc.y + 14);
        doc.y += 30;
      }

      if (np.hydration) {
        doc.fill(CHARCOAL).fontSize(10).font('Helvetica-Bold')
          .text(`Hydration: ${np.hydration}`, 50, doc.y);
        doc.y += 20;
      }
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.fill('#CCCCCC').fontSize(8).font('Helvetica')
      .text('fitnessbymaddy.com | This program is for personal use only.', 50, footerY, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
