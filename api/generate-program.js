const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');

const RISKY_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /clenbuterol|dnp|sarm|steroid|ephedra/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
];

function hasSafetyIssue(text) {
  return RISKY_PATTERNS.some((p) => p.test(text));
}

async function generatePlan(client, checkins) {
  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const clientContext = `
Client: ${client.name || 'Anonymous'}
Program: ${client.program}
Week: ${checkins.length + 1} of 12
${checkins.length > 0 ? `Last check-in (week ${checkins[0].week_no}):
  Weight: ${checkins[0].weight || 'N/A'} kg
  Waist: ${checkins[0].waist || 'N/A'} cm
  Compliance: ${checkins[0].compliance_score || 'N/A'}/10
  Energy: ${checkins[0].energy || 'N/A'}/10
  Issues: ${checkins[0].issues || 'None'}
  Focus: ${checkins[0].next_week_focus || 'General'}` : 'First week — no prior data.'}
${checkins.length > 1 ? `Previous check-in (week ${checkins[1].week_no}):
  Weight: ${checkins[1].weight || 'N/A'} kg
  Compliance: ${checkins[1].compliance_score || 'N/A'}/10` : ''}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a certified fitness program architect for FitnessByMaddy. Generate a weekly training and nutrition program.

${clientContext}

Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "Upper Body", "exercises": [
        {"name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": ""}
      ]},
      ...
    ],
    "rest_days": ["Sunday"],
    "cardio": {"type": "", "frequency": "", "duration": ""}
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meals": [
      {"meal": "Breakfast", "options": ["Option 1", "Option 2"]},
      ...
    ],
    "supplements": ["Whey protein", "Creatine"],
    "hydration": "3L water daily"
  },
  "weekly_focus": "Brief motivational note for the week",
  "adjustments": "What changed from last week and why"
}

Rules:
- Safe, evidence-based recommendations only
- No extreme calorie deficits (minimum 1400 cal for women, 1600 for men)
- No banned substances or questionable supplements
- Adjust based on compliance and energy scores
- Progressive overload from previous week if data available`,
    }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse program JSON from Claude response');

  const plan = JSON.parse(jsonMatch[0]);

  const fullText = JSON.stringify(plan);
  if (hasSafetyIssue(fullText)) {
    return { plan: null, flagged: true, reason: 'Safety check failed — review needed' };
  }

  return { plan, flagged: false };
}

async function renderPDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 100).fill('#1a1a1a');
    doc.fill('#B8965A').fontSize(28).font('Helvetica-Bold')
      .text('FITNESS BY MADDY', 40, 30);
    doc.fill('#ffffff').fontSize(14).font('Helvetica')
      .text(`Week ${weekNo} Program — ${client.name || 'Client'}`, 40, 65);

    doc.fill('#2C2C2C');
    let y = 120;

    doc.fontSize(18).font('Helvetica-Bold').text('WORKOUT PLAN', 40, y);
    y += 30;

    if (plan.workout_plan?.days) {
      for (const day of plan.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 40; }
        doc.fill('#B8965A').fontSize(13).font('Helvetica-Bold').text(
          `${day.day} — ${day.focus}`, 40, y
        );
        y += 20;
        doc.fill('#2C2C2C').fontSize(10).font('Helvetica');
        for (const ex of day.exercises || []) {
          doc.text(
            `  •  ${ex.name}  |  ${ex.sets} × ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  — ' + ex.notes : ''}`,
            50, y
          );
          y += 16;
        }
        y += 10;
      }
    }

    if (y > 600) { doc.addPage(); y = 40; }
    y += 10;
    doc.fontSize(18).font('Helvetica-Bold').fill('#1a1a1a').text('NUTRITION PLAN', 40, y);
    y += 30;

    const np = plan.nutrition_plan;
    if (np) {
      doc.fontSize(11).font('Helvetica').fill('#2C2C2C');
      doc.text(`Calories: ${np.calories} kcal  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fats: ${np.fats_g}g`, 40, y);
      y += 25;

      for (const meal of np.meals || []) {
        if (y > 720) { doc.addPage(); y = 40; }
        doc.font('Helvetica-Bold').text(meal.meal, 40, y);
        y += 16;
        doc.font('Helvetica');
        for (const opt of meal.options || []) {
          doc.text(`  •  ${opt}`, 50, y);
          y += 14;
        }
        y += 8;
      }
    }

    if (plan.weekly_focus) {
      if (y > 700) { doc.addPage(); y = 40; }
      y += 15;
      doc.fill('#B8965A').fontSize(12).font('Helvetica-Bold').text('WEEKLY FOCUS', 40, y);
      y += 18;
      doc.fill('#2C2C2C').fontSize(10).font('Helvetica').text(plan.weekly_focus, 40, y, { width: 500 });
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { plan, flagged, reason } = await generatePlan(client, checkins || []);

    if (flagged) {
      const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy('Program safety flag', { phone: client.phone, body: reason });
      return res.status(200).json({ ok: false, flagged: true, reason });
    }

    const pdfBuffer = await renderPDF(client, week_no, plan);
    const filePath = `${client.folder_url || 'clients/' + client_id}/week_${week_no}.pdf`;

    await supabase.storage.from('clients').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = supabase.storage.from('clients').getPublicUrl(filePath);
    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.weekly_focus,
    });

    const market = detectMarket(client.phone);
    const context = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! 💪 Check karo aur questions ho toh poochho.`
      : `Your Week ${week_no} program is ready! 💪 Check it out and let us know if you have questions.`;

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      context,
      pdfUrl,
    ]);

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
