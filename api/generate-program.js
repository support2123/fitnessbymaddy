const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { programDisplayName } = require('../lib/utils');

const DANGEROUS_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm|steroid/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { client_id, week_no } = req.body || {};

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .or(`lead_id.eq.${client.lead_id},phone.eq.${client.phone}`)
      .order('submitted_at', { ascending: false })
      .limit(1);

    const clientProfile = {
      name: client.name,
      program: programDisplayName(client.program),
      week: week_no,
      totalWeeks: client.program === '12wk' ? 12 : 6,
      intake: intake?.[0] || {},
      recentCheckins: checkins || [],
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy, an elite online coaching brand. You create personalised weekly training and nutrition plans.

Rules:
- Never prescribe below 1400 calories for women or 1600 for men
- Never recommend banned substances, SARMs, or steroids
- Never promise unrealistic timelines (max 1kg/week fat loss)
- Always include warm-up and cooldown in workouts
- Nutrition must include adequate protein (1.6-2.2g/kg bodyweight)
- Account for any injuries or medical conditions from the intake form
- Progressive overload: increase difficulty slightly each week
- Be specific with exercise names, sets, reps, rest periods
- Include RPE (Rate of Perceived Exertion) targets

Output format: Return valid JSON with exactly this structure:
{
  "workout_plan": {
    "days": [
      {"day": "Monday", "focus": "Upper Body Push", "exercises": [{"name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "rpe": "7-8", "notes": "..."}], "warmup": "...", "cooldown": "..."},
    ],
    "rest_days": ["Sunday"],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 165,
    "carbs_g": 250,
    "fat_g": 75,
    "meals": [
      {"meal": "Breakfast", "options": ["...", "..."]},
    ],
    "supplements": ["..."],
    "hydration": "...",
    "weekly_notes": "..."
  },
  "coach_note": "One-liner motivational context for WhatsApp delivery"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:
${JSON.stringify(clientProfile, null, 2)}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].text;

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(text)) {
        await escalateToMaddy({
          reason: 'Flagged content in generated program',
          phone: client.phone,
          clientName: client.name,
          details: `Week ${week_no}: matched pattern ${pattern.source}`,
        });
        return res.status(200).json({
          flagged: true,
          reason: 'Content flagged for review',
        });
      }
    }

    let plan;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      plan = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const pdfBuffer = await generatePDF(client, week_no, plan);

    const fileName = `week_${week_no}.pdf`;
    const storagePath = `${client.folder_url || `clients/${client.id}`}/${fileName}`;

    const { error: uploadErr } = await db.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = db.storage
        .from('programs')
        .getPublicUrl(storagePath);
      pdfUrl = urlData?.publicUrl;
    }

    await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: plan.workout_plan,
      nutrition_plan: plan.nutrition_plan,
      notes: plan.coach_note,
    });

    if (pdfUrl) {
      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_program',
        bodyValues: [
          client.name || 'there',
          week_no.toString(),
          plan.coach_note || 'Your new week awaits!',
        ],
        mediaUrl: pdfUrl,
      });

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('client_id', client_id).eq('week_no', week_no);
    }

    return res.status(200).json({
      success: true,
      pdf_url: pdfUrl,
      week_no,
    });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function generatePDF(client, weekNo, plan) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');

    doc.fontSize(28).fill('#B8965A')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 4 });
    doc.fontSize(14).fill('#FFFFFF')
      .text(`WEEK ${weekNo} PROGRAM`, 50, 75, { characterSpacing: 2 });
    doc.fontSize(10).fill('rgba(255,255,255,0.6)')
      .text(`${client.name || 'Client'} | ${programDisplayName(client.program)}`, 50, 95);

    let y = 150;

    if (plan.workout_plan) {
      doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
      y += 30;

      const days = plan.workout_plan.days || [];
      for (const day of days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill('#2C2C2C')
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').text(`Warm-up: ${day.warmup}`, 70, y);
          y += 14;
        }

        for (const ex of (day.exercises || [])) {
          if (y > 730) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#2C2C2C')
            .text(`• ${ex.name}`, 70, y);
          doc.fontSize(9).fill('#6B6B6B')
            .text(`${ex.sets} × ${ex.reps} | Rest: ${ex.rest} | RPE: ${ex.rpe || 'N/A'}`, 90, y + 13);
          y += 30;
        }

        if (day.cooldown) {
          doc.fontSize(9).fill('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 70, y);
          y += 14;
        }
        y += 10;
      }
    }

    if (plan.nutrition_plan) {
      if (y > 550) { doc.addPage(); y = 50; }

      doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
      y += 30;

      const np = plan.nutrition_plan;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories} cal | ${np.protein_g}g protein | ${np.carbs_g}g carbs | ${np.fat_g}g fat`, 50, y);
      y += 25;

      for (const meal of (np.meals || [])) {
        if (y > 730) { doc.addPage(); y = 50; }
        doc.fontSize(11).fill('#2C2C2C').text(meal.meal, 50, y);
        y += 16;
        for (const opt of (meal.options || [])) {
          doc.fontSize(9).fill('#6B6B6B').text(`  → ${opt}`, 70, y);
          y += 13;
        }
        y += 8;
      }

      if (np.supplements && np.supplements.length > 0) {
        y += 5;
        doc.fontSize(11).fill('#2C2C2C').text('Supplements:', 50, y);
        y += 16;
        for (const sup of np.supplements) {
          doc.fontSize(9).fill('#6B6B6B').text(`  • ${sup}`, 70, y);
          y += 13;
        }
      }
    }

    doc.addPage();
    doc.rect(0, doc.page.height - 60, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(8).fill('#B8965A')
      .text('FITNESS BY MADDY | fitnessbymaddy.com | @fitnessbymaddy_',
        50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}
