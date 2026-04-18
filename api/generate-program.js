const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: intake } = await db
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect for FitnessByMaddy. Generate a week's training and nutrition plan.

RULES:
- Never prescribe extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned substances or supplements requiring prescription
- Never promise specific weight loss timelines
- Base recommendations on the client's data, compliance history, and energy levels
- Be warm, expert, and encouraging — not bro-sciency
- Output valid JSON only`;

    const userPrompt = `Generate Week ${week_no} program for this client.

CLIENT PROFILE:
${JSON.stringify({
  name: client.name,
  program: client.program,
  started: client.program_started_at,
  intake: intake ? {
    age: intake.age,
    gender: intake.gender,
    goal: intake.goal,
    injuries: intake.injuries,
    diet_pref: intake.diet_pref,
    schedule: intake.schedule,
    experience: intake.experience,
    current_weight: intake.current_weight,
    target_weight: intake.target_weight,
    height: intake.height,
  } : 'No intake form submitted',
}, null, 2)}

RECENT CHECK-INS (newest first):
${JSON.stringify(checkins || [], null, 2)}

Output this exact JSON structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "" }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_notes": "..."
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "suggestion": "...", "calories": 500 }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "context_note": "One-liner summary for WhatsApp message"
}`;

    const response = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude' });
    }

    const program = JSON.parse(jsonMatch[0]);

    if (hasSafetyIssues(program)) {
      const { notifyMaddy } = require('./_lib/escalation');
      await notifyMaddy('Program flagged for safety review', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program has potential safety issues — review needed before sending`,
      });
      return res.status(200).json({
        action: 'flagged_for_review',
        reason: 'Safety check triggered',
      });
    }

    const pdfBuffer = await generatePDF(client, week_no, program);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('programs').upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage
      .from('programs')
      .getPublicUrl(filePath);

    const pdfUrl = urlData?.publicUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.context_note || '',
    });

    if (pdfUrl) {
      await sendWhatsApp(client.phone, 'weekly_program', [
        client.name || 'there',
        `Week ${week_no}`,
        program.context_note || 'Your new program is ready!',
      ], pdfUrl);

      await db
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('client_id', client_id)
        .eq('week_no', week_no);
    }

    return res.status(200).json({ action: 'program_generated', week: week_no, pdfUrl });
  } catch (err) {
    console.error('Generate program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function hasSafetyIssues(program) {
  const cal = program.nutrition_plan?.daily_calories;
  if (cal && cal < 1200) return true;

  const banned = ['steroids', 'sarms', 'clenbuterol', 'dnp', 'ephedra', 'hgh'];
  const supps = (program.nutrition_plan?.supplements || '').toLowerCase();
  if (banned.some((b) => supps.includes(b))) return true;

  return false;
}

async function generatePDF(client, weekNo, program) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 40);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program`, 50, 80);
    doc.fontSize(10).fill('#D4AF7A').text(`Prepared for ${client.name || 'Client'}`, 50, 100);

    doc.moveDown(3);

    doc.fontSize(18).fill('#2C2C2C').text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const days = program.workout_plan?.days || [];
    for (const day of days) {
      if (doc.y > 700) doc.addPage();

      doc.fontSize(13).fill('#B8965A').text(`${day.day} — ${day.focus}`, 50);
      doc.moveDown(0.3);

      if (day.warmup) {
        doc.fontSize(9).fill('#6B6B6B').text(`Warm-up: ${day.warmup}`, 60);
      }

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        doc.fontSize(10).fill('#2C2C2C')
          .text(`${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60);
        if (ex.notes) {
          doc.fontSize(8).fill('#6B6B6B').text(`  ${ex.notes}`, 70);
        }
      }

      if (day.cooldown) {
        doc.fontSize(9).fill('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 60);
      }
      doc.moveDown(0.8);
    }

    if (program.workout_plan?.weekly_notes) {
      doc.fontSize(9).fill('#6B6B6B').text(program.workout_plan.weekly_notes, 50);
      doc.moveDown(1);
    }

    if (doc.y > 600) doc.addPage();

    doc.fontSize(18).fill('#2C2C2C').text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
    doc.moveDown(0.5);

    const np = program.nutrition_plan || {};
    doc.fontSize(11).fill('#2C2C2C')
      .text(`Daily Target: ${np.daily_calories || '—'} kcal  |  Protein: ${np.protein_g || '—'}g  |  Carbs: ${np.carbs_g || '—'}g  |  Fat: ${np.fat_g || '—'}g`, 50);
    doc.moveDown(0.8);

    const meals = np.meals || [];
    for (const meal of meals) {
      doc.fontSize(11).fill('#B8965A').text(meal.meal, 50);
      doc.fontSize(10).fill('#2C2C2C').text(`${meal.suggestion} (~${meal.calories} kcal)`, 60);
      doc.moveDown(0.4);
    }

    if (np.hydration) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 50);
    }
    if (np.supplements) {
      doc.fontSize(10).fill('#6B6B6B').text(`Supplements: ${np.supplements}`, 50);
    }

    doc.moveDown(2);
    doc.fontSize(8).fill('#C8B89A')
      .text('This program is personalized and confidential. For support, message us on WhatsApp.', 50, doc.y, { align: 'center' });

    doc.end();
  });
}
