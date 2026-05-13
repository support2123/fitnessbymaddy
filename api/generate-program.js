const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i,
  /under\s*1[,.]?000\s*cal/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroid/i,
  /anabolic/i,
  /lose\s*\d{2,}\s*(kg|lb|pound).*per\s*week/i
];

function auditProgramSafety(workoutPlan, nutritionPlan) {
  const combined = JSON.stringify(workoutPlan) + JSON.stringify(nutritionPlan);
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(combined)) return { safe: false, reason: pattern.toString() };
  }
  return { safe: true };
}

async function generateWithClaude(client, checkins) {
  const anthropic = new Anthropic();

  const latestCheckins = checkins.slice(-2).map(c => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance: c.compliance_score,
    energy: c.energy,
    issues: c.issues
  }));

  const prompt = `You are a certified fitness program architect for FitnessByMaddy, a premium online coaching brand.

Client profile:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}

Recent check-in data:
${JSON.stringify(latestCheckins, null, 2)}

Generate a structured weekly program. Output ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "overview": "Brief week focus (1 sentence)",
    "days": [
      {
        "day": "Monday",
        "focus": "e.g. Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
        ],
        "cardio": "optional cardio recommendation"
      }
    ],
    "deload_notes": "if applicable"
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 70,
    "meal_timing": [
      { "meal": "Meal 1 — Pre-workout", "time": "7:00 AM", "description": "..." }
    ],
    "hydration": "recommendation",
    "supplements": ["list if applicable"]
  },
  "coach_note": "A short motivational note from Maddy (1-2 sentences)"
}

Rules:
- Never suggest calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Base adjustments on the check-in data trends
- Keep it evidence-based and practical
- If compliance is low, simplify the plan rather than adding volume`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  return JSON.parse(jsonMatch[0]);
}

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header — black/gold branded
    doc.rect(0, 0, doc.page.width, 100).fill('#2C2C2C');
    doc.fontSize(28).fill('#B8965A').text('FITNESS BY MADDY', 50, 30, { align: 'left' });
    doc.fontSize(12).fill('#FFFFFF').text(
      `Week ${weekNo} Program — ${client.name || 'Client'}`,
      50, 65, { align: 'left' }
    );

    doc.moveDown(3);
    doc.fill('#2C2C2C');

    // Workout section
    const wp = programData.workout_plan;
    doc.fontSize(18).text('WORKOUT PLAN', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fill('#6B6B6B').text(wp.overview || '');
    doc.moveDown(1);

    if (wp.days) {
      for (const day of wp.days) {
        doc.fontSize(14).fill('#B8965A').text(`${day.day} — ${day.focus}`);
        doc.moveDown(0.3);
        if (day.exercises) {
          for (const ex of day.exercises) {
            doc.fontSize(10).fill('#2C2C2C').text(
              `  • ${ex.name}: ${ex.sets} x ${ex.reps} | Rest: ${ex.rest}${ex.notes ? ' — ' + ex.notes : ''}`,
              { indent: 20 }
            );
          }
        }
        if (day.cardio) {
          doc.fontSize(10).fill('#6B6B6B').text(`  Cardio: ${day.cardio}`, { indent: 20 });
        }
        doc.moveDown(0.5);
      }
    }

    // Nutrition section
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 60).fill('#2C2C2C');
    doc.fontSize(18).fill('#B8965A').text('NUTRITION PLAN', 50, 20);
    doc.moveDown(3);
    doc.fill('#2C2C2C');

    const np = programData.nutrition_plan;
    doc.fontSize(12).text(`Daily Targets: ${np.daily_calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`);
    doc.moveDown(1);

    if (np.meal_timing) {
      for (const meal of np.meal_timing) {
        doc.fontSize(11).fill('#B8965A').text(`${meal.meal} (${meal.time})`);
        doc.fontSize(10).fill('#2C2C2C').text(`  ${meal.description}`, { indent: 20 });
        doc.moveDown(0.3);
      }
    }

    if (np.hydration) {
      doc.moveDown(0.5);
      doc.fontSize(10).fill('#6B6B6B').text(`Hydration: ${np.hydration}`);
    }

    // Coach note
    if (programData.coach_note) {
      doc.moveDown(1.5);
      doc.rect(50, doc.y, doc.page.width - 100, 50).fill('#FAF8F4');
      doc.fontSize(11).fill('#B8965A').text(`"${programData.coach_note}"`, 60, doc.y - 40, {
        width: doc.page.width - 120,
        align: 'center'
      });
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

    const { data: existing } = await getSupabase()
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.json({ skipped: true, reason: 'Already generated' });
    }

    const { data: client } = await getSupabase()
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkins } = await getSupabase()
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: true });

    const programData = await generateWithClaude(client, checkins || []);
    const safety = auditProgramSafety(programData.workout_plan, programData.nutrition_plan);

    if (!safety.safe) {
      await notifyMaddy(
        'Program flagged — unsafe content',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nReason: ${safety.reason}`
      );
      return res.json({ flagged: true, reason: safety.reason });
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    const { error: uploadErr } = await getSupabase().storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = getSupabase().storage
      .from('client-files')
      .getPublicUrl(pdfPath);
    const pdfUrl = urlData?.publicUrl || pdfPath;

    await getSupabase().from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_note
    });

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      pdfUrl
    ], client.name);

    await getSupabase()
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
