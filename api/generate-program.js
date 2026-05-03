const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./_lib/supabase');
const { sendMedia } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 cal', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'sarms', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
];

function hasSafetyIssue(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

async function generateWithClaude(clientData, checkins) {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  const lastCheckins = checkins.slice(0, 2).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues,
  }));

  const prompt = `You are a certified fitness program architect for FitnessByMaddy. Generate a personalized weekly program.

CLIENT PROFILE:
- Name: ${clientData.name}
- Program: ${clientData.program}
- Week: ${clientData.week_no}
- Started: ${clientData.program_started_at}

RECENT CHECK-INS:
${JSON.stringify(lastCheckins, null, 2)}

Generate a complete weekly program in JSON format with these exact keys:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-12", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ],
    "weekly_note": "..."
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 65,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "supplements": ["..."],
    "hydration": "...",
    "weekly_note": "..."
  },
  "context_note": "One-liner summary for WhatsApp message"
}

RULES:
- Never go below 1200 calories for women or 1500 for men
- No banned substances, no extreme protocols
- Progressive overload from previous weeks
- Adjust based on compliance and energy scores
- Be specific with exercise names, not generic
- Include rest days`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

async function renderPDF(programData, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 35);
    doc.fontSize(14).fill('#FFFFFF').text(`Week ${weekNo} Program — ${clientName}`, 50, 75);

    doc.moveDown(3);

    const wp = programData.workout_plan;
    if (wp) {
      doc.fontSize(20).fill('#2C2C2C').text('WORKOUT PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);

      if (wp.weekly_note) {
        doc.fontSize(10).fill('#6B6B6B').text(wp.weekly_note, 50);
        doc.moveDown(0.5);
      }

      const days = wp.days || [];
      for (const day of days) {
        if (doc.y > 680) doc.addPage();

        doc.fontSize(14).fill('#B8965A').text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc.fontSize(9).fill('#6B6B6B').text(`Warm-up: ${day.warmup}`, 60);
        }

        const exercises = day.exercises || [];
        for (const ex of exercises) {
          doc.fontSize(10).fill('#2C2C2C').text(
            `• ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`,
            60
          );
          if (ex.notes) {
            doc.fontSize(8).fill('#6B6B6B').text(`  ${ex.notes}`, 70);
          }
        }

        if (day.cooldown) {
          doc.fontSize(9).fill('#6B6B6B').text(`Cool-down: ${day.cooldown}`, 60);
        }
        doc.moveDown(0.5);
      }
    }

    if (doc.y > 500) doc.addPage();

    const np = programData.nutrition_plan;
    if (np) {
      doc.moveDown(1);
      doc.fontSize(20).fill('#2C2C2C').text('NUTRITION PLAN', 50);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#B8965A');
      doc.moveDown(0.5);

      doc.fontSize(11).fill('#2C2C2C').text(
        `Calories: ${np.calories}  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`,
        50
      );
      doc.moveDown(0.5);

      const meals = np.meals || [];
      for (const meal of meals) {
        doc.fontSize(12).fill('#B8965A').text(meal.meal, 50);
        const opts = meal.options || [];
        for (const opt of opts) {
          doc.fontSize(10).fill('#2C2C2C').text(`  • ${opt}`, 60);
        }
        doc.moveDown(0.3);
      }

      if (np.supplements && np.supplements.length) {
        doc.moveDown(0.3);
        doc.fontSize(11).fill('#2C2C2C').text('Supplements:', 50);
        for (const s of np.supplements) {
          doc.fontSize(10).fill('#6B6B6B').text(`  • ${s}`, 60);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`, 50);
      }

      if (np.weekly_note) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#6B6B6B').text(np.weekly_note, 50);
      }
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#E8E3DC');
    doc.moveDown(0.5);
    doc.fontSize(8).fill('#C8B89A').text(
      'Generated by FitnessByMaddy Coaching System  •  fitnessbymaddy.com',
      50, doc.y, { align: 'center' }
    );

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const programData = await generateWithClaude(
      { ...client, week_no },
      checkins || []
    );

    const fullOutput = JSON.stringify(programData);
    if (hasSafetyIssue(fullOutput)) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy(
        'Unsafe program content flagged',
        client.phone,
        `Week ${week_no} generation contained safety flags`
      );
      return res.status(200).json({ success: false, reason: 'safety_review_needed' });
    }

    const pdfBuffer = await renderPDF(programData, client.name, week_no);

    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('programs').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    const { data: urlData } = db.storage.from('programs').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || '';

    await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      whatsapp_sent_at: null,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.context_note || null,
    });

    const caption = programData.context_note || `Week ${week_no} program ready!`;
    await sendMedia(client.phone, pdfUrl, caption, true);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no, 10));

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ success: true, pdfUrl });
  } catch (err) {
    console.error(`Generate program error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
