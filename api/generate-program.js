const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const UNSAFE_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*(10|15|20)\+?\s*kg\s*in\s*(1|2)\s*week/i,
  /extreme\s*cut/i,
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { data: intake } = await db
      .from('lead_intakes')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    const market = detectMarket(client.phone);

    const prompt = buildPrompt(client, intake, checkins, week_no, market);

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || '';

    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(responseText)) {
        await escalateToMaddy(
          'Unsafe content in generated program',
          client.phone,
          `Week ${week_no}: matched pattern ${pattern.source}`
        );
        return res.json({ ok: false, reason: 'flagged_for_review', week_no });
      }
    }

    let workoutPlan, nutritionPlan, notes;
    try {
      const parsed = JSON.parse(responseText);
      workoutPlan = parsed.workout_plan || parsed.workout || null;
      nutritionPlan = parsed.nutrition_plan || parsed.nutrition || null;
      notes = parsed.notes || parsed.coach_notes || '';
    } catch {
      workoutPlan = { raw: responseText };
      nutritionPlan = null;
      notes = '';
    }

    const pdfBuffer = generatePdf(client, week_no, workoutPlan, nutritionPlan, notes);
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage.from('client-files').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    const { data: pdfUrlData } = db.storage.from('client-files').getPublicUrl(pdfPath);
    const pdfUrl = pdfUrlData.publicUrl;

    const { data: program } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
      generated_at: new Date().toISOString(),
    }).select().single();

    const contextNote = isHinglish(market)
      ? `Week ${week_no} ka program ready hai! Check karo aur koi doubt ho toh batao.`
      : `Your Week ${week_no} program is ready! Review it and let me know if you have questions.`;

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      week_no.toString(),
      contextNote,
    ], pdfUrl);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq('id', program.id);

    return res.json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('[generate-program]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildPrompt(client, intake, checkins, weekNo, market) {
  const lang = isHinglish(market) ? 'Use Hinglish where appropriate.' : '';
  const checkinSummary = checkins && checkins.length > 0
    ? checkins.map(c => `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, compliance=${c.compliance_score}/10, energy=${c.energy}/10, issues=${c.issues || 'none'}`).join('\n')
    : 'No previous check-ins available.';

  const intakeInfo = intake
    ? `Goal: ${intake.goal || 'general fitness'}\nInjuries: ${intake.injuries || 'none'}\nMedical: ${intake.medical_conditions || 'none'}\nDiet: ${intake.diet_preference || 'flexible'}\nSchedule: ${intake.workout_schedule || 'flexible'}\nActivity Level: ${intake.current_activity_level || 'moderate'}\nEquipment: ${intake.equipment_available || 'full gym'}`
    : 'No intake data available.';

  return `You are an expert fitness coach creating a weekly personalized program.

CLIENT: ${client.name || 'Client'}
PROGRAM: ${client.program} (Week ${weekNo} of ${client.program === '12wk' ? 12 : 6})
${lang}

INTAKE PROFILE:
${intakeInfo}

RECENT CHECK-INS:
${checkinSummary}

Create a complete Week ${weekNo} program. Return ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ]},
      ...
    ],
    "cardio": { "frequency": "3x/week", "type": "LISS or HIIT", "duration": "20-30min" }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 220,
    "fat_g": 75,
    "meal_timing": ["Pre-workout: ...", "Post-workout: ..."],
    "sample_meals": ["Meal 1: ...", "Meal 2: ..."],
    "supplements": ["Whey protein", "Creatine 5g"]
  },
  "notes": "Coach notes for the week..."
}

RULES:
- Never recommend fewer than 1400 calories for women or 1600 for men
- No banned substances, no extreme protocols
- Progressive overload from previous weeks
- Adjust based on check-in data (compliance, energy, issues)
- If client reported pain/injury, modify exercises to avoid aggravation
- Keep it practical and science-based`;
}

function generatePdf(client, weekNo, workoutPlan, nutritionPlan, notes) {
  const lines = [];
  lines.push('FITNESS BY MADDY');
  lines.push(`Week ${weekNo} Program - ${client.name || 'Client'}`);
  lines.push(`Program: ${client.program}`);
  lines.push('');

  if (workoutPlan && workoutPlan.days) {
    lines.push('=== WORKOUT PLAN ===');
    for (const day of workoutPlan.days) {
      lines.push(`\n--- ${day.day}: ${day.focus} ---`);
      if (day.exercises) {
        for (const ex of day.exercises) {
          lines.push(`  ${ex.name}: ${ex.sets}x${ex.reps} (Rest: ${ex.rest})${ex.notes ? ' - ' + ex.notes : ''}`);
        }
      }
    }
    if (workoutPlan.cardio) {
      lines.push(`\nCardio: ${workoutPlan.cardio.frequency} - ${workoutPlan.cardio.type} - ${workoutPlan.cardio.duration}`);
    }
  } else if (workoutPlan && workoutPlan.raw) {
    lines.push('=== WORKOUT PLAN ===');
    lines.push(workoutPlan.raw);
  }

  lines.push('');

  if (nutritionPlan) {
    lines.push('=== NUTRITION PLAN ===');
    lines.push(`Calories: ${nutritionPlan.calories || 'TBD'}`);
    lines.push(`Protein: ${nutritionPlan.protein_g || 'TBD'}g | Carbs: ${nutritionPlan.carbs_g || 'TBD'}g | Fat: ${nutritionPlan.fat_g || 'TBD'}g`);
    if (nutritionPlan.meal_timing) {
      lines.push('\nMeal Timing:');
      nutritionPlan.meal_timing.forEach(m => lines.push(`  ${m}`));
    }
    if (nutritionPlan.sample_meals) {
      lines.push('\nSample Meals:');
      nutritionPlan.sample_meals.forEach(m => lines.push(`  ${m}`));
    }
    if (nutritionPlan.supplements) {
      lines.push('\nSupplements:');
      nutritionPlan.supplements.forEach(s => lines.push(`  ${s}`));
    }
  }

  if (notes) {
    lines.push('\n=== COACH NOTES ===');
    lines.push(notes);
  }

  lines.push('\n---');
  lines.push('fitnessbymaddy.com | @fitnessbymaddy_');

  return Buffer.from(lines.join('\n'), 'utf-8');
}
