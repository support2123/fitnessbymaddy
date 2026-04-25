const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800', 'extreme cut',
  'clenbuterol', 'dnp', 'ephedra', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'crash diet', 'starvation',
];

function hasSafetyViolation(text) {
  const lower = (text || '').toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: intakeRaw } = await db.storage
      .from('client-data')
      .download(`intakes/${client.lead_id}.json`);

    let intake = {};
    if (intakeRaw) {
      try {
        const text = await intakeRaw.text();
        intake = JSON.parse(text);
      } catch (_) {}
    }

    const anthropic = new Anthropic();
    const checkinSummary = (recentCheckins || []).map(c =>
      `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues="${c.issues || 'none'}"`
    ).join('\n');

    const prompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${intake.age || 'unknown'}
- Gender: ${intake.gender || 'unknown'}
- Goal: ${intake.goal || 'fat loss + muscle building'}
- Injuries: ${intake.injuries || 'none reported'}
- Diet preference: ${intake.diet_pref || 'no restriction'}
- Schedule: ${intake.schedule || 'flexible'}
- Current weight: ${intake.current_weight || 'unknown'}
- Target weight: ${intake.target_weight || 'unknown'}

RECENT CHECK-INS:
${checkinSummary || 'No prior check-ins (Week 1)'}

Generate Week ${week_no} program. Output valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 4, "reps": "8-12", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": ["..."],
    "sample_meals": { "breakfast": "...", "lunch": "...", "dinner": "...", "snacks": "..." },
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_focus": "One sentence focus for this week",
  "coach_note": "Personal note from Maddy to the client"
}

Rules:
- Never go below 1200 cal for women or 1500 for men
- No banned substances or supplements
- Be realistic about timelines
- Adjust based on check-in data (compliance, energy, issues)
- If injuries mentioned, modify exercises to avoid aggravation`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = response.content[0].text;

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const programData = JSON.parse(jsonMatch[0]);

    const fullText = JSON.stringify(programData);
    if (hasSafetyViolation(fullText)) {
      await escalateToMaddy('Safety flag in generated program - halted', {
        phone: client.phone,
        name: client.name,
        message: `Week ${week_no} program flagged for review`,
      });
      return res.json({ action: 'flagged_for_review', week_no });
    }

    const pdfBuffer = await generatePDF(client, week_no, programData);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;

    await db.storage.from('client-data')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    const { data: urlData } = db.storage
      .from('client-data')
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData.publicUrl;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note || '',
      generated_at: new Date().toISOString(),
    }).select().single();

    const contextNote = programData.weekly_focus || `Week ${week_no} program ready!`;
    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      contextNote,
    ], pdfUrl);

    await db.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', maskPhone(''), err.message);
    return res.status(500).json({ error: 'Generation failed' });
  }
};

function generatePDF(client, weekNo, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 120).fill('#2C2C2C');
    doc.fill('#B8965A').fontSize(28).text('FITNESS BY MADDY', 50, 35, { align: 'center' });
    doc.fill('#FFFFFF').fontSize(14).text(`WEEK ${weekNo} PROGRAM`, 50, 75, { align: 'center' });
    doc.fill('#999999').fontSize(10).text(`Prepared for ${client.name || 'Client'}`, 50, 95, { align: 'center' });

    doc.moveDown(3);

    if (data.weekly_focus) {
      doc.fill('#B8965A').fontSize(12).text('WEEKLY FOCUS', 50);
      doc.fill('#2C2C2C').fontSize(11).text(data.weekly_focus, 50, doc.y + 5, { width: 500 });
      doc.moveDown(1.5);
    }

    doc.fill('#B8965A').fontSize(16).text('WORKOUT PLAN', 50);
    doc.moveDown(0.5);

    if (data.workout_plan && data.workout_plan.days) {
      for (const day of data.workout_plan.days) {
        if (doc.y > 700) doc.addPage();

        doc.fill('#2C2C2C').fontSize(13).text(`${day.day} — ${day.focus}`, 50);
        doc.moveDown(0.3);

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fill('#6B6B6B').fontSize(10)
              .text(`  ${ex.name}  |  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest}`, 60, doc.y, { width: 480 });
            if (ex.notes) {
              doc.fill('#999999').fontSize(9).text(`    ${ex.notes}`, 70);
            }
          }
        }
        doc.moveDown(0.8);
      }
    }

    if (data.workout_plan && data.workout_plan.cardio) {
      doc.fill('#2C2C2C').fontSize(11).text(
        `Cardio: ${data.workout_plan.cardio.type} — ${data.workout_plan.cardio.frequency}, ${data.workout_plan.cardio.duration}`, 50
      );
      doc.moveDown(1.5);
    }

    if (doc.y > 600) doc.addPage();

    doc.fill('#B8965A').fontSize(16).text('NUTRITION PLAN', 50);
    doc.moveDown(0.5);

    if (data.nutrition_plan) {
      const np = data.nutrition_plan;
      doc.fill('#2C2C2C').fontSize(11)
        .text(`Daily Calories: ${np.calories} kcal`, 50)
        .text(`Protein: ${np.protein_g}g  |  Carbs: ${np.carbs_g}g  |  Fat: ${np.fat_g}g`, 50);
      doc.moveDown(0.5);

      if (np.sample_meals) {
        doc.fill('#6B6B6B').fontSize(10);
        if (np.sample_meals.breakfast) doc.text(`Breakfast: ${np.sample_meals.breakfast}`, 60, doc.y, { width: 480 });
        if (np.sample_meals.lunch) doc.text(`Lunch: ${np.sample_meals.lunch}`, 60, doc.y, { width: 480 });
        if (np.sample_meals.dinner) doc.text(`Dinner: ${np.sample_meals.dinner}`, 60, doc.y, { width: 480 });
        if (np.sample_meals.snacks) doc.text(`Snacks: ${np.sample_meals.snacks}`, 60, doc.y, { width: 480 });
      }

      doc.moveDown(0.5);
      if (np.hydration) {
        doc.fill('#6B6B6B').fontSize(10).text(`Hydration: ${np.hydration}`, 60);
      }
    }

    if (data.coach_note) {
      doc.moveDown(2);
      doc.fill('#B8965A').fontSize(12).text('NOTE FROM MADDY', 50);
      doc.fill('#2C2C2C').fontSize(11).text(data.coach_note, 50, doc.y + 5, { width: 500 });
    }

    const bottomY = doc.page.height - 40;
    doc.fill('#CCCCCC').fontSize(8)
      .text('fitnessbymaddy.com | @fitnessbymaddy_', 50, bottomY, { align: 'center', width: 500 });

    doc.end();
  });
}
