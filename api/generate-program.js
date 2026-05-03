const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'starvation', 'very low calorie',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

async function generateWithClaude(clientData, checkins) {
  const client = new Anthropic();

  const lastCheckin = checkins[0] || {};
  const prevCheckin = checkins[1] || {};

  const prompt = `You are a certified fitness program architect for FitnessByMaddy. Generate a personalized weekly program.

CLIENT PROFILE:
- Name: ${clientData.name}
- Program: ${clientData.program}
- Current weight: ${lastCheckin.weight || 'N/A'} kg
- Previous weight: ${prevCheckin.weight || 'N/A'} kg
- Waist: ${lastCheckin.waist || 'N/A'} cm
- Compliance last week: ${lastCheckin.compliance_score || 'N/A'}/10
- Energy level: ${lastCheckin.energy || 'N/A'}/10
- Issues reported: ${lastCheckin.issues || 'None'}
- Week number: ${clientData.week_no}

RULES:
- Science-backed, progressive overload principles
- Never prescribe below 1200 calories for women or 1500 for men
- No banned substances or supplements
- Realistic timelines only
- If the client reported issues, adapt the program accordingly
- Include warm-up and cool-down in every session

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] },
      ...
    ],
    "warmup": "...",
    "cooldown": "..."
  },
  "nutrition_plan": {
    "calories": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "meals": [
      { "meal": "Breakfast", "options": ["...", "..."] },
      ...
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "coach_note": "One-liner context for the client"
}

Respond with ONLY the JSON object, no markdown fences.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  return JSON.parse(text);
}

async function generatePDF(programData, clientName, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 30);
    doc.fontSize(14).fill('#FFFFFF')
      .text(`Week ${weekNo} Program — ${clientName}`, 50, 65);

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout Plan
    const wp = programData.workout_plan;
    if (wp) {
      doc.fontSize(20).fill('#B8965A').text('WORKOUT PLAN');
      doc.moveDown(0.5);

      if (wp.warmup) {
        doc.fontSize(10).fill('#6B6B6B').text(`Warm-up: ${wp.warmup}`);
        doc.moveDown(0.3);
      }

      if (wp.days) {
        for (const day of wp.days) {
          doc.moveDown(0.5);
          doc.fontSize(14).fill('#2C2C2C').text(`${day.day} — ${day.focus}`);
          doc.moveDown(0.3);

          if (day.exercises) {
            for (const ex of day.exercises) {
              doc.fontSize(10).fill('#6B6B6B')
                .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}${ex.notes ? '  |  ' + ex.notes : ''}`, { indent: 20 });
            }
          }
        }
      }

      if (wp.cooldown) {
        doc.moveDown(0.5);
        doc.fontSize(10).fill('#6B6B6B').text(`Cool-down: ${wp.cooldown}`);
      }
    }

    // Nutrition Plan
    const np = programData.nutrition_plan;
    if (np) {
      doc.moveDown(1.5);
      doc.fontSize(20).fill('#B8965A').text('NUTRITION PLAN');
      doc.moveDown(0.5);

      doc.fontSize(11).fill('#2C2C2C')
        .text(`Daily Targets: ${np.calories} kcal  |  P: ${np.protein_g}g  |  C: ${np.carbs_g}g  |  F: ${np.fat_g}g`);
      doc.moveDown(0.5);

      if (np.meals) {
        for (const meal of np.meals) {
          doc.fontSize(12).fill('#2C2C2C').text(meal.meal);
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(10).fill('#6B6B6B').text(`  — ${opt}`, { indent: 20 });
            }
          }
          doc.moveDown(0.3);
        }
      }

      if (np.hydration) {
        doc.moveDown(0.3);
        doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`);
      }
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fill('#C8B89A')
      .text('This program is personalized for you by FitnessByMaddy. Do not share or redistribute.', { align: 'center' });

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Check if already generated
    const { data: existing } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(200).json({ action: 'already_generated', program_id: existing.id });
    }

    // Get last 2 check-ins
    const { data: checkins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Generate with Claude
    const programData = await generateWithClaude(
      { ...client, week_no },
      checkins || []
    );

    // Safety check
    const programText = JSON.stringify(programData);
    if (hasSafetyIssue(programText)) {
      await notifyMaddy(
        'Program safety flag',
        `Client: ${client.name} (${client.id})\nWeek ${week_no}\nFlagged content detected — manual review required`
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: 'FLAGGED: Safety review required before sending',
      });

      return res.status(200).json({ action: 'flagged_for_review' });
    }

    // Generate PDF
    const pdfBuffer = await generatePDF(programData, client.name || 'Client', week_no);

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

    const { data: urlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    // Store in programs table (audit trail)
    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null,
    }).select().single();

    // Send via WhatsApp
    const market = 'IN'; // default, could be looked up from lead
    const coachNote = programData.coach_note || `Here's your Week ${week_no} program!`;
    const templateName = isHinglish(market) ? 'weekly_program_hi' : 'weekly_program';
    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      String(week_no),
      coachNote,
      pdfUrl,
    ]);
    await logMessage(client.phone, 'out', null, templateName);

    // Update sent timestamp
    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};
