const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { cors, maskPhone, PROGRAM_NAMES } = require('../lib/helpers');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    let intakeData = null;
    try {
      const { data: intakeFile } = await supabase.storage
        .from('client-data')
        .download(`intakes/${client.lead_id}.json`);
      if (intakeFile) {
        intakeData = JSON.parse(await intakeFile.text());
      }
    } catch (e) { /* no intake form yet */ }

    const programPlan = await generateWithClaude(client, recentCheckins, intakeData, week_no);

    if (programPlan.flagged) {
      await notifyMaddy(
        'Program flagged for review',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: ${programPlan.flagReason}`
      );
      return res.status(200).json({ success: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, programPlan, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('client-data')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('client-data')
      .getPublicUrl(pdfPath);

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: publicUrl,
      workout_plan: programPlan.workout,
      nutrition_plan: programPlan.nutrition,
      notes: programPlan.coachNote
    });

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'there',
        `Week ${week_no}`,
        programPlan.coachNote || 'Your new program is ready!'
      ],
      mediaUrl: publicUrl
    });

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ success: true, pdf_url: publicUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function generateWithClaude(client, checkins, intakeData, weekNo) {
  const checkinSummary = (checkins || []).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  const prompt = `You are a program architect for FitnessByMaddy, a premium online fitness coaching brand.

Generate a complete Week ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${PROGRAM_NAMES[client.program] || client.program}
- Started: ${client.program_started_at}
${intakeData ? `
- Age: ${intakeData.age}
- Gender: ${intakeData.gender}
- Goal: ${intakeData.goal}
- Experience: ${intakeData.experience}
- Injuries: ${intakeData.injuries || 'None reported'}
- Diet preference: ${intakeData.diet_preference || 'No preference'}
- Schedule: ${intakeData.schedule || 'Flexible'}
- Current weight: ${intakeData.current_weight || 'Not provided'}
- Target weight: ${intakeData.target_weight || 'Not provided'}
- Height: ${intakeData.height || 'Not provided'}
- Medical conditions: ${intakeData.medical_conditions || 'None'}
` : '- No intake form submitted yet'}

RECENT CHECK-INS:
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : 'No check-ins yet (Week 1)'}

RULES:
- Never prescribe extreme calorie cuts (below 1200 for women, 1500 for men)
- Never mention banned/controlled substances
- Never promise specific weight loss timelines
- If client reported pain/injury, modify exercises accordingly
- Progressive overload: increase volume/intensity from last week
- Include rest days and deload guidance when appropriate

Return ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "warmup": "5 min rowing + dynamic stretches",
        "cooldown": "5 min stretching"
      }
    ]
  },
  "nutrition": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] }
    ],
    "supplements": ["Whey protein", "Creatine 5g"],
    "hydration": "3-4L water daily",
    "notes": "Any dietary notes"
  },
  "coachNote": "One-liner motivational context note for WhatsApp",
  "flagged": false,
  "flagReason": ""
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const plan = JSON.parse(jsonMatch[0]);

  if (plan.nutrition?.calories) {
    if (plan.nutrition.calories < 1200) {
      plan.flagged = true;
      plan.flagReason = `Calories too low: ${plan.nutrition.calories}`;
    }
  }

  return plan;
}

async function generatePDF(client, plan, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const charcoal = '#2C2C2C';
    const gold = '#B8965A';
    const midGrey = '#6B6B6B';
    const lightGrey = '#E8E3DC';
    const cream = '#FAF8F4';

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill(charcoal);
    doc.fontSize(28).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(12).fillColor(gold).font('Helvetica')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 65);
    doc.fontSize(10).fillColor('#FFFFFF')
      .text(client.name || 'Client', doc.page.width - 200, 35, { width: 150, align: 'right' });
    doc.fontSize(9).fillColor(gold)
      .text(PROGRAM_NAMES[client.program] || '', doc.page.width - 200, 50, { width: 150, align: 'right' });

    doc.y = 120;

    // Coach note
    if (plan.coachNote) {
      doc.rect(50, doc.y, doc.page.width - 100, 40).fill(cream);
      doc.fontSize(10).fillColor(charcoal).font('Helvetica-Oblique')
        .text(`"${plan.coachNote}"`, 60, doc.y + 12, { width: doc.page.width - 120 });
      doc.y += 55;
    }

    // Workout section
    doc.fontSize(16).fillColor(gold).font('Helvetica-Bold')
      .text('WORKOUT PLAN', 50, doc.y);
    doc.y += 25;

    if (plan.workout?.days) {
      for (const day of plan.workout.days) {
        if (doc.y > doc.page.height - 150) doc.addPage();

        doc.rect(50, doc.y, doc.page.width - 100, 24).fill(charcoal);
        doc.fontSize(11).fillColor('#FFFFFF').font('Helvetica-Bold')
          .text(`${day.day.toUpperCase()} — ${day.focus}`, 60, doc.y + 6);
        doc.y += 30;

        if (day.warmup) {
          doc.fontSize(8).fillColor(midGrey).font('Helvetica')
            .text(`Warm-up: ${day.warmup}`, 60, doc.y);
          doc.y += 14;
        }

        // Table header
        doc.fontSize(8).fillColor(gold).font('Helvetica-Bold');
        doc.text('EXERCISE', 60, doc.y, { width: 180 });
        doc.text('SETS', 250, doc.y, { width: 40 });
        doc.text('REPS', 300, doc.y, { width: 60 });
        doc.text('REST', 370, doc.y, { width: 50 });
        doc.text('NOTES', 430, doc.y, { width: 120 });
        doc.y += 14;

        doc.moveTo(60, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(lightGrey).stroke();
        doc.y += 4;

        for (const ex of (day.exercises || [])) {
          if (doc.y > doc.page.height - 60) doc.addPage();
          doc.fontSize(9).fillColor(charcoal).font('Helvetica');
          doc.text(ex.name, 60, doc.y, { width: 180 });
          doc.text(String(ex.sets), 250, doc.y, { width: 40 });
          doc.text(ex.reps, 300, doc.y, { width: 60 });
          doc.text(ex.rest || '', 370, doc.y, { width: 50 });
          doc.fontSize(8).fillColor(midGrey)
            .text(ex.notes || '', 430, doc.y, { width: 120 });
          doc.y += 16;
        }

        if (day.cooldown) {
          doc.fontSize(8).fillColor(midGrey).font('Helvetica')
            .text(`Cool-down: ${day.cooldown}`, 60, doc.y);
          doc.y += 14;
        }

        doc.y += 10;
      }
    }

    // Nutrition section
    if (doc.y > doc.page.height - 200) doc.addPage();

    doc.fontSize(16).fillColor(gold).font('Helvetica-Bold')
      .text('NUTRITION PLAN', 50, doc.y);
    doc.y += 25;

    if (plan.nutrition) {
      const n = plan.nutrition;

      // Macro boxes
      const macros = [
        { label: 'CALORIES', value: `${n.calories || '—'}` },
        { label: 'PROTEIN', value: `${n.protein_g || '—'}g` },
        { label: 'CARBS', value: `${n.carbs_g || '—'}g` },
        { label: 'FAT', value: `${n.fat_g || '—'}g` }
      ];

      const boxW = (doc.page.width - 100 - 30) / 4;
      macros.forEach((m, i) => {
        const x = 50 + i * (boxW + 10);
        doc.rect(x, doc.y, boxW, 50).fill(cream);
        doc.fontSize(8).fillColor(midGrey).font('Helvetica-Bold')
          .text(m.label, x + 10, doc.y + 8, { width: boxW - 20 });
        doc.fontSize(18).fillColor(charcoal).font('Helvetica-Bold')
          .text(m.value, x + 10, doc.y + 22, { width: boxW - 20 });
      });
      doc.y += 65;

      // Meals
      if (n.meals) {
        for (const meal of n.meals) {
          if (doc.y > doc.page.height - 80) doc.addPage();
          doc.fontSize(10).fillColor(charcoal).font('Helvetica-Bold')
            .text(meal.meal, 60, doc.y);
          doc.y += 14;
          for (const opt of (meal.options || [])) {
            doc.fontSize(9).fillColor(midGrey).font('Helvetica')
              .text(`→ ${opt}`, 70, doc.y, { width: doc.page.width - 140 });
            doc.y += 14;
          }
          doc.y += 6;
        }
      }

      // Supplements
      if (n.supplements && n.supplements.length > 0) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        doc.fontSize(10).fillColor(gold).font('Helvetica-Bold')
          .text('SUPPLEMENTS', 60, doc.y);
        doc.y += 14;
        for (const s of n.supplements) {
          doc.fontSize(9).fillColor(charcoal).font('Helvetica')
            .text(`• ${s}`, 70, doc.y);
          doc.y += 13;
        }
        doc.y += 10;
      }

      if (n.hydration) {
        doc.fontSize(9).fillColor(midGrey).font('Helvetica')
          .text(`💧 ${n.hydration}`, 60, doc.y);
        doc.y += 20;
      }
    }

    // Footer
    const footerY = doc.page.height - 40;
    doc.rect(0, footerY, doc.page.width, 40).fill(charcoal);
    doc.fontSize(8).fillColor(gold).font('Helvetica')
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, footerY + 14);
    doc.fontSize(7).fillColor('#666666')
      .text('This program is personalized. Do not share or redistribute.', doc.page.width - 280, footerY + 14, { width: 230, align: 'right' });

    doc.end();
  });
}
