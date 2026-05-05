const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

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
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: baseline } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .eq('week_no', 0)
      .single();

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      baseline: baseline ? JSON.parse(baseline.issues || '{}') : {},
      recentCheckins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
        focus: c.next_week_focus
      }))
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: buildPrompt(clientProfile)
      }]
    });

    const content = response.content[0].text;
    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const program = JSON.parse(jsonMatch[1]);

    // Safety check
    const programText = JSON.stringify(program).toLowerCase();
    const flagged = SAFETY_FLAGS.some(f => programText.includes(f));
    if (flagged) {
      const { sendWhatsApp: _ } = require('./_lib/whatsapp');
      const { createEscalation } = require('./_lib/escalation');
      await createEscalation({
        sourceType: 'client',
        sourceId: client_id,
        phone: client.phone,
        reason: 'Program flagged for safety review — contains risky content',
        messageBody: `Week ${week_no} program generation flagged`
      });
      return res.json({ ok: false, reason: 'flagged_for_review' });
    }

    const pdfBuffer = await generatePDF(client, week_no, program);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('client-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || filePath;

    await supabase.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: program.workout,
      nutrition_plan: program.nutrition,
      notes: program.notes || null
    }, { onConflict: 'client_id,week_no' });

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      body: `Week ${week_no} program is ready! 💪 ${program.notes || 'Keep pushing — consistency is everything.'}`,
      params: [client.name || 'Champion', String(week_no)]
    });

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', week_no);

    return res.json({ ok: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(profile) {
  return `You are a program architect for FitnessByMaddy, an elite online coaching brand. Generate a weekly training and nutrition program.

CLIENT PROFILE:
- Name: ${profile.name || 'Client'}
- Program: ${profile.program}
- Current Week: ${profile.week}
- Baseline Data: ${JSON.stringify(profile.baseline)}
- Recent Check-ins: ${JSON.stringify(profile.recentCheckins)}

RULES:
- Warm, expert tone. Never bro-sciency. Never over-promise.
- Programs must be safe, evidence-based, and progressive.
- Never prescribe extreme calorie deficits (min 1200 kcal for women, 1500 kcal for men).
- Never mention banned substances or supplements without strong evidence.
- Adjust based on compliance score and reported issues from check-ins.
- If compliance is low, simplify. If energy is low, reduce volume.

OUTPUT FORMAT — respond with a single JSON block:
\`\`\`json
{
  "workout": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "3x 20min moderate intensity (walk/cycle)",
    "steps_target": 8000
  },
  "nutrition": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with protein powder and berries" }
    ],
    "hydration": "3L water daily",
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "One-liner context note for WhatsApp"
}
\`\`\``;
}

async function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35, { align: 'left' });
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 75);
    doc.fontSize(10).fill('#D4AF7A').text(client.name || 'Client', 50, 95);

    doc.fill('#2C2C2C');
    let y = 140;

    // Workout section
    doc.fontSize(18).fill('#B8965A').text('WORKOUT PLAN', 50, y);
    y += 30;

    if (program.workout?.days) {
      for (const day of program.workout.days) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.fontSize(13).fill('#2C2C2C').text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;
        for (const ex of day.exercises || []) {
          if (y > 730) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill('#6B6B6B')
            .text(`• ${ex.name}: ${ex.sets} × ${ex.reps} (rest ${ex.rest})`, 70, y);
          y += 16;
        }
        y += 10;
      }
    }

    if (program.workout?.cardio) {
      if (y > 700) { doc.addPage(); y = 50; }
      doc.fontSize(10).fill('#6B6B6B').text(`Cardio: ${program.workout.cardio}`, 50, y);
      y += 16;
      doc.text(`Daily steps target: ${program.workout.steps_target || 8000}`, 50, y);
      y += 30;
    }

    // Nutrition section
    if (y > 600) { doc.addPage(); y = 50; }
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, y);
    y += 30;

    if (program.nutrition) {
      const n = program.nutrition;
      doc.fontSize(11).fill('#2C2C2C')
        .text(`Calories: ${n.calories} kcal | Protein: ${n.protein_g}g | Carbs: ${n.carbs_g}g | Fat: ${n.fat_g}g`, 50, y);
      y += 25;

      for (const meal of n.meals || []) {
        if (y > 730) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill('#6B6B6B')
          .text(`• ${meal.meal}: ${meal.suggestion}`, 70, y);
        y += 16;
      }

      y += 10;
      if (n.hydration) {
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${n.hydration}`, 50, y);
        y += 16;
      }
      if (n.supplements?.length) {
        doc.text(`Supplements: ${n.supplements.join(', ')}`, 50, y);
        y += 16;
      }
    }

    // Footer
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill('#C8B89A')
        .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, doc.page.height - 40, { align: 'center' });
    }

    doc.end();
  });
}
