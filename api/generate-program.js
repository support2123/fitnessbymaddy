const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const RISKY_PATTERNS = [
  /under\s*1[,.]?[0-2]\d{2}\s*cal/i,
  /less\s*than\s*1[,.]?[0-2]\d{2}\s*cal/i,
  /clenbuterol|dnp|ephedra|sarm|steroid|testosterone\s+inject/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*per\s*week/i,
  /extreme\s*(fast|cut|deficit)/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

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

    const { data: prevPrograms } = await db
      .from('programs')
      .select('week_no, workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prompt = buildPrompt(client, checkins || [], prevPrograms || [], week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a NASM-certified fitness program architect. Output ONLY valid JSON with workout_plan, nutrition_plan, and coach_note fields. Never recommend banned substances, extreme calorie restrictions (<1200 cal), or unrealistic timelines.',
    });

    const rawText = response.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    const isRisky = RISKY_PATTERNS.some((p) => p.test(fullText));
    if (isRisky) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy({
        reason: 'Risky program content flagged',
        phone: client.phone,
        message: `Week ${week_no} program flagged for review`,
      });
      return res.status(200).json({ flagged: true, reason: 'Content flagged for Maddy review' });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadError } = await db.storage
      .from('clients')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError.message);
    }

    const { data: urlData } = db.storage
      .from('clients')
      .getPublicUrl(filePath);

    const pdfUrl = urlData ? urlData.publicUrl : null;

    await db.from('programs').insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || null,
    });

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [
        client.name || 'Champion',
        String(week_no),
        programData.coach_note || `Week ${week_no} program is ready! Let's crush it 💪`,
      ],
      mediaUrl: pdfUrl,
    });

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      success: true,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function buildPrompt(client, checkins, prevPrograms, weekNo) {
  const checkinSummary = checkins.map((c) =>
    `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
  ).join('\n');

  const prevSummary = prevPrograms.length > 0
    ? `Previous program (Week ${prevPrograms[0].week_no}): ${JSON.stringify(prevPrograms[0].workout_plan).slice(0, 500)}`
    : 'No previous program';

  return `Generate Week ${weekNo} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM:
${prevSummary}

OUTPUT FORMAT (JSON only):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "15 min incline walk"
      }
    ],
    "weekly_volume": "16 sets chest, 16 sets back, ...",
    "progression_note": "Increase weight by 2.5kg on compounds if all reps hit"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fats_g": 70,
    "meal_timing": [
      { "meal": "Meal 1 (8am)", "description": "4 eggs, 2 toast, 1 banana", "macros": "P:28g C:45g F:18g" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein", "Creatine 5g", "Vitamin D3"]
  },
  "coach_note": "One-liner motivation/context for this week"
}

Tailor to check-in data: if compliance is low, simplify. If energy is low, reduce volume slightly. Progress overload where metrics show readiness.`;
}

function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const CHARCOAL = '#2C2C2C';
    const GOLD = '#B8965A';
    const MID_GREY = '#6B6B6B';
    const LIGHT_GREY = '#E8E3DC';
    const CREAM = '#FAF8F4';

    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fill('#FFFFFF')
      .text('FITNESS BY MADDY', 50, 35, { characterSpacing: 3 });
    doc.fontSize(12).fill(GOLD)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72, { characterSpacing: 2 });
    doc.fontSize(10).fill('#888888')
      .text(`${client.name || 'Client'} · ${client.program.toUpperCase()}`, 50, 92);

    let y = 145;

    doc.rect(0, y - 10, doc.page.width, 1).fill(GOLD);
    y += 10;

    if (programData.workout_plan && programData.workout_plan.days) {
      doc.fontSize(16).fill(CHARCOAL).text('WORKOUT PLAN', 50, y, { characterSpacing: 2 });
      y += 30;

      for (const day of programData.workout_plan.days) {
        if (y > 700) { doc.addPage(); y = 50; }

        doc.rect(50, y, doc.page.width - 100, 24).fill(CREAM);
        doc.fontSize(11).fill(GOLD)
          .text(`${day.day.toUpperCase()} — ${(day.focus || '').toUpperCase()}`, 60, y + 6, { characterSpacing: 1 });
        y += 32;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 730) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(CHARCOAL)
              .text(`→  ${ex.name}`, 60, y);
            doc.fill(MID_GREY)
              .text(`${ex.sets} × ${ex.reps}  |  Rest: ${ex.rest}`, 280, y);
            if (ex.notes) {
              doc.fontSize(8).fill(MID_GREY).text(ex.notes, 60, y + 14);
              y += 12;
            }
            y += 18;
          }
        }

        if (day.cardio) {
          doc.fontSize(9).fill(MID_GREY).text(`Cardio: ${day.cardio}`, 60, y);
          y += 18;
        }
        y += 8;
      }

      if (programData.workout_plan.progression_note) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.rect(50, y, doc.page.width - 100, 1).fill(LIGHT_GREY);
        y += 10;
        doc.fontSize(9).fill(GOLD).text('PROGRESSION:', 50, y);
        doc.fontSize(9).fill(MID_GREY).text(programData.workout_plan.progression_note, 130, y);
        y += 25;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      doc.rect(50, y, doc.page.width - 100, 1).fill(GOLD);
      y += 15;

      doc.fontSize(16).fill(CHARCOAL).text('NUTRITION PLAN', 50, y, { characterSpacing: 2 });
      y += 30;

      const np = programData.nutrition_plan;
      doc.rect(50, y, doc.page.width - 100, 40).fill(CREAM);
      doc.fontSize(10).fill(CHARCOAL);
      const macroText = `Calories: ${np.calories}  |  Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fats: ${np.fats_g}g`;
      doc.text(macroText, 60, y + 12);
      y += 52;

      if (np.meal_timing) {
        for (const meal of np.meal_timing) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(10).fill(GOLD).text(meal.meal, 60, y);
          y += 15;
          doc.fontSize(9).fill(CHARCOAL).text(meal.description, 60, y, { width: 350 });
          if (meal.macros) {
            doc.fontSize(8).fill(MID_GREY).text(meal.macros, 420, y);
          }
          y += 18;
        }
      }

      if (np.hydration) {
        y += 5;
        doc.fontSize(9).fill(MID_GREY).text(`Hydration: ${np.hydration}`, 60, y);
        y += 15;
      }

      if (np.supplements && np.supplements.length > 0) {
        doc.fontSize(9).fill(MID_GREY).text(`Supplements: ${np.supplements.join(', ')}`, 60, y);
        y += 15;
      }
    }

    if (programData.coach_note) {
      if (y > 700) { doc.addPage(); y = 50; }
      y += 15;
      doc.rect(50, y, doc.page.width - 100, 40).fill(CHARCOAL);
      doc.fontSize(10).fill(GOLD).text("COACH'S NOTE:", 60, y + 8);
      doc.fontSize(9).fill('#FFFFFF').text(programData.coach_note, 150, y + 8, { width: 340 });
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fill(MID_GREY)
        .text('fitnessbymaddy.com', 50, doc.page.height - 30)
        .text(`Page ${i + 1} of ${pageCount}`, doc.page.width - 120, doc.page.height - 30);
    }

    doc.end();
  });
}
