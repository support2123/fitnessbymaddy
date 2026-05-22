const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/helpers');
const { createEscalation } = require('../lib/escalation');
const Anthropic = require('@anthropic-ai/sdk');
const PDFDocument = require('pdfkit');

// ── Brand constants ────────────────────────────────────────────────
const BRAND_GOLD = [184, 150, 90]; // #B8965A
const BRAND_BLACK = [20, 20, 20];
const BRAND_WHITE = [255, 255, 255];
const BRAND_GRAY = [180, 180, 180];

// ── Safety thresholds ──────────────────────────────────────────────
const MIN_CALORIES_FEMALE = 1200;
const MIN_CALORIES_MALE = 1500;
const BANNED_TERMS = [
  'dnp', 'clenbuterol', 'ephedra', 'sibutramine', 'fen-phen',
  'phentermine', 'anabolic steroid', 'sarm', 'sarms', 'hgh',
  'testosterone inject', 'tren', 'trenbolone', 'diuretic',
  'laxative for weight', 'ipecac', 'purge', 'starvation',
];

// ── Claude system prompt ───────────────────────────────────────────
function buildSystemPrompt(clientContext, checkinContext) {
  return `You are an expert NASM-certified fitness program architect working for FITNESS BY MADDY, a premium online fitness coaching brand. Your job is to create safe, effective, personalized weekly workout and nutrition programs.

CLIENT PROFILE:
${clientContext}

RECENT CHECK-IN DATA:
${checkinContext}

OUTPUT FORMAT:
You MUST respond with valid JSON only. No markdown, no code fences, no commentary. The JSON must have this exact structure:

{
  "week_focus": "A one-sentence summary of this week's focus and progression",
  "workout_plan": [
    {
      "day": "Day 1 - Upper Body Push",
      "exercises": [
        {
          "name": "Barbell Bench Press",
          "sets": 4,
          "reps": "8-10",
          "rest_seconds": 90,
          "notes": "Progressive overload: add 2.5kg if all reps completed last week"
        }
      ]
    }
  ],
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fat_g": 60,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "time": "8:00 AM",
        "foods": ["3 whole eggs scrambled", "2 slices whole wheat toast", "1 cup spinach"],
        "approx_calories": 450,
        "protein_g": 30
      }
    ],
    "hydration_liters": 3,
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"]
  }
}

SAFETY RULES (MANDATORY):
- Minimum daily calories: ${MIN_CALORIES_FEMALE} for women, ${MIN_CALORIES_MALE} for men. NEVER go below these.
- NEVER recommend banned or controlled substances: DNP, clenbuterol, ephedra, SARMs, anabolic steroids, HGH injections, diuretics for weight loss, laxatives for weight loss.
- Apply progressive overload: increase volume or intensity by no more than 10% per week.
- If client reported pain or injury in check-ins, avoid or modify exercises for that area.
- If energy score is below 5, reduce volume by 10-15% and add a deload note.
- If compliance is below 6, simplify the plan (fewer meals, shorter workouts).
- Maximum realistic fat loss: 0.5-1kg per week. Do not promise faster results.
- Include rest days appropriate to training level.
- All supplement recommendations must be legal over-the-counter options only.

PROGRAMMING PRINCIPLES:
- Design around the client's available equipment and workout days.
- Respect the client's schedule (wake/sleep times) for meal timing.
- Account for dietary preferences (vegetarian, vegan, halal, etc).
- Use compound movements as primary lifts, isolation as accessories.
- Include warm-up and cool-down recommendations.
- Adjust based on check-in weight trend: if plateau, modify approach.

Output valid JSON only.`;
}

// ── Authentication ─────────────────────────────────────────────────
function isAuthorized(req) {
  const internalKey = req.headers['x-internal-key'];
  if (internalKey && internalKey === process.env.INTERNAL_API_KEY) {
    return true;
  }
  // Also allow calls with client_id + week_no in body (for cron/internal use)
  const { client_id, week_no } = req.body || {};
  if (client_id && week_no !== undefined) {
    return true;
  }
  return false;
}

// ── Safety validation ──────────────────────────────────────────────
function validateSafety(program, gender) {
  const issues = [];

  // Check calorie minimum
  const calories = program.nutrition_plan?.daily_calories;
  const minCal = gender === 'female' ? MIN_CALORIES_FEMALE : MIN_CALORIES_MALE;
  if (calories && calories < minCal) {
    issues.push(`Calories too low: ${calories} (min ${minCal} for ${gender || 'unknown'})`);
  }

  // Check for banned terms in the entire JSON string
  const planText = JSON.stringify(program).toLowerCase();
  for (const term of BANNED_TERMS) {
    if (planText.includes(term.toLowerCase())) {
      issues.push(`Banned term detected: "${term}"`);
    }
  }

  return issues;
}

// ── PDF generation ─────────────────────────────────────────────────
function generatePDF(clientName, weekNo, weekFocus, workoutPlan, nutritionPlan) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const marginLeft = 40;
      const contentWidth = pageWidth - 80;

      // ── Header ───────────────────────────────────────────────
      doc.rect(0, 0, pageWidth, 100).fill(`rgb(${BRAND_BLACK.join(',')})`);

      doc.font('Helvetica-Bold')
        .fontSize(28)
        .fill(`rgb(${BRAND_GOLD.join(',')})`)
        .text('FITNESS BY MADDY', marginLeft, 25, { width: contentWidth, align: 'center' });

      doc.font('Helvetica')
        .fontSize(12)
        .fill(`rgb(${BRAND_WHITE.join(',')})`)
        .text(`Week ${weekNo} Program`, marginLeft, 60, { width: contentWidth, align: 'center' });

      doc.font('Helvetica')
        .fontSize(10)
        .text(`Prepared for ${clientName}`, marginLeft, 78, { width: contentWidth, align: 'center' });

      doc.moveDown(2);
      let y = 120;

      // ── Week focus ───────────────────────────────────────────
      if (weekFocus) {
        doc.fill(`rgb(${BRAND_GOLD.join(',')})`)
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(`This week's focus: ${weekFocus}`, marginLeft, y, { width: contentWidth });
        y = doc.y + 15;
      }

      // ── Workout plan section ─────────────────────────────────
      doc.fill(`rgb(${BRAND_GOLD.join(',')})`)
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('WORKOUT PLAN', marginLeft, y);

      doc.moveTo(marginLeft, doc.y + 4)
        .lineTo(marginLeft + 150, doc.y + 4)
        .strokeColor(`rgb(${BRAND_GOLD.join(',')})`)
        .lineWidth(2)
        .stroke();

      y = doc.y + 12;

      for (const day of (workoutPlan || [])) {
        // Check if we need a new page
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = 40;
        }

        doc.fill(`rgb(${BRAND_BLACK.join(',')})`)
          .font('Helvetica-Bold')
          .fontSize(13)
          .text(day.day || 'Workout Day', marginLeft, y);
        y = doc.y + 6;

        for (const ex of (day.exercises || [])) {
          if (y > doc.page.height - 80) {
            doc.addPage();
            y = 40;
          }

          const setsReps = `${ex.sets || '-'} x ${ex.reps || '-'}`;
          const rest = ex.rest_seconds ? ` | Rest: ${ex.rest_seconds}s` : '';

          doc.fill(`rgb(${BRAND_BLACK.join(',')})`)
            .font('Helvetica-Bold')
            .fontSize(10)
            .text(`  ${ex.name || 'Exercise'}`, marginLeft, y);

          doc.font('Helvetica')
            .fontSize(9)
            .fill(`rgb(${BRAND_GRAY.join(',')})`)
            .text(`    ${setsReps}${rest}`, marginLeft, doc.y + 1);

          if (ex.notes) {
            doc.font('Helvetica-Oblique')
              .fontSize(8)
              .text(`    ${ex.notes}`, marginLeft, doc.y + 1, { width: contentWidth - 20 });
          }

          y = doc.y + 6;
        }

        y = doc.y + 10;
      }

      // ── Nutrition plan section ───────────────────────────────
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
      }

      doc.fill(`rgb(${BRAND_GOLD.join(',')})`)
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('NUTRITION PLAN', marginLeft, y + 10);

      doc.moveTo(marginLeft, doc.y + 4)
        .lineTo(marginLeft + 150, doc.y + 4)
        .strokeColor(`rgb(${BRAND_GOLD.join(',')})`)
        .lineWidth(2)
        .stroke();

      y = doc.y + 12;

      // Daily macros summary
      const np = nutritionPlan || {};
      doc.fill(`rgb(${BRAND_BLACK.join(',')})`)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('Daily Targets', marginLeft, y);
      y = doc.y + 4;

      doc.font('Helvetica')
        .fontSize(10)
        .fill(`rgb(${BRAND_BLACK.join(',')})`)
        .text(`Calories: ${np.daily_calories || '-'} kcal  |  Protein: ${np.protein_g || '-'}g  |  Carbs: ${np.carbs_g || '-'}g  |  Fat: ${np.fat_g || '-'}g`, marginLeft, y);

      if (np.hydration_liters) {
        doc.text(`Water: ${np.hydration_liters}L daily`, marginLeft, doc.y + 3);
      }

      y = doc.y + 12;

      // Meals
      for (const meal of (np.meals || [])) {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 40;
        }

        doc.fill(`rgb(${BRAND_BLACK.join(',')})`)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(`${meal.name || 'Meal'}${meal.time ? ' (' + meal.time + ')' : ''}`, marginLeft, y);

        if (meal.approx_calories || meal.protein_g) {
          doc.font('Helvetica')
            .fontSize(8)
            .fill(`rgb(${BRAND_GRAY.join(',')})`)
            .text(`~${meal.approx_calories || 0} kcal | ${meal.protein_g || 0}g protein`, marginLeft + 10, doc.y + 1);
        }

        for (const food of (meal.foods || [])) {
          doc.font('Helvetica')
            .fontSize(9)
            .fill(`rgb(${BRAND_BLACK.join(',')})`)
            .text(`  - ${food}`, marginLeft + 10, doc.y + 2);
        }

        y = doc.y + 8;
      }

      // Supplements
      if (np.supplements && np.supplements.length > 0) {
        y = doc.y + 6;
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 40;
        }

        doc.fill(`rgb(${BRAND_BLACK.join(',')})`)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('Supplements', marginLeft, y);

        for (const supp of np.supplements) {
          doc.font('Helvetica')
            .fontSize(9)
            .fill(`rgb(${BRAND_BLACK.join(',')})`)
            .text(`  - ${supp}`, marginLeft + 10, doc.y + 2);
        }
      }

      // ── Footer ───────────────────────────────────────────────
      const footerY = doc.page.height - 60;
      doc.rect(0, footerY, pageWidth, 60).fill(`rgb(${BRAND_BLACK.join(',')})`);

      doc.font('Helvetica-Bold')
        .fontSize(9)
        .fill(`rgb(${BRAND_GOLD.join(',')})`)
        .text('Trust the process. Your consistency is your superpower.', marginLeft, footerY + 15, {
          width: contentWidth,
          align: 'center',
        });

      doc.font('Helvetica')
        .fontSize(7)
        .fill(`rgb(${BRAND_GRAY.join(',')})`)
        .text('fitnessbymaddy.com | @fitnessbymaddy', marginLeft, footerY + 35, {
          width: contentWidth,
          align: 'center',
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Build client context string for Claude ─────────────────────────
function buildClientContext(client, intake) {
  const lines = [];
  lines.push(`Name: ${client.name || 'N/A'}`);
  lines.push(`Program: ${client.program}`);
  lines.push(`Status: ${client.status}`);

  if (intake) {
    if (intake.age) lines.push(`Age: ${intake.age}`);
    if (intake.gender) lines.push(`Gender: ${intake.gender}`);
    if (intake.height_cm) lines.push(`Height: ${intake.height_cm} cm`);
    if (intake.current_weight) lines.push(`Current weight: ${intake.current_weight} kg`);
    if (intake.goal_weight) lines.push(`Goal weight: ${intake.goal_weight} kg`);
    if (intake.primary_goal) lines.push(`Primary goal: ${intake.primary_goal}`);
    if (intake.injuries) lines.push(`Injuries/limitations: ${intake.injuries}`);
    if (intake.medical_conditions) lines.push(`Medical conditions: ${intake.medical_conditions}`);
    if (intake.diet_preference) lines.push(`Diet preference: ${intake.diet_preference}`);
    if (intake.meals_per_day) lines.push(`Preferred meals per day: ${intake.meals_per_day}`);
    if (intake.workout_days_per_week) lines.push(`Workout days per week: ${intake.workout_days_per_week}`);
    if (intake.equipment_access) lines.push(`Equipment access: ${intake.equipment_access}`);
    if (intake.wake_time) lines.push(`Wake time: ${intake.wake_time}`);
    if (intake.sleep_time) lines.push(`Sleep time: ${intake.sleep_time}`);
  } else {
    lines.push('No intake form data available — use sensible defaults for a general fitness program.');
  }

  return lines.join('\n');
}

function buildCheckinContext(checkins) {
  if (!checkins || checkins.length === 0) {
    return 'No previous check-in data available. This is the client\'s first week — design an introductory program.';
  }

  return checkins.map((c) => {
    const parts = [`Week ${c.week_no}:`];
    if (c.weight) parts.push(`Weight: ${c.weight} kg`);
    if (c.waist) parts.push(`Waist: ${c.waist} cm`);
    if (c.compliance_score) parts.push(`Compliance: ${c.compliance_score}/10`);
    if (c.energy) parts.push(`Energy: ${c.energy}/10`);
    if (c.issues) parts.push(`Issues: ${c.issues}`);
    if (c.next_week_focus) parts.push(`Focus noted: ${c.next_week_focus}`);
    return parts.join(' | ');
  }).join('\n');
}

// ── Main handler ───────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Internal-Key');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body || {};

  if (!client_id) {
    return res.status(400).json({ error: 'Missing required field: client_id' });
  }

  const weekNumber = week_no || 1;

  try {
    // ── 1. Fetch client with intake data ───────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*, lead_id')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      console.error('[GenProgram] Client not found:', client_id);
      return res.status(404).json({ error: 'Client not found' });
    }

    console.log(`[GenProgram] Generating week ${weekNumber} for client ${client_id} (${maskPhone(client.phone)})`);

    // Fetch intake submission via lead_id
    let intake = null;
    if (client.lead_id) {
      const { data: intakeData } = await supabase
        .from('intake_submissions')
        .select('*')
        .eq('lead_id', client.lead_id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      intake = intakeData;
    }

    // ── 2. Fetch last 2 check-ins ─────────────────────────────
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // ── 3. Build prompts and call Claude ───────────────────────
    const clientContext = buildClientContext(client, intake);
    const checkinContext = buildCheckinContext(checkins);
    const systemPrompt = buildSystemPrompt(clientContext, checkinContext);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    console.log(`[GenProgram] Calling Claude API for client ${client_id}, week ${weekNumber}`);

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate the week ${weekNumber} program for this client. Consider their progression and any check-in feedback. Output valid JSON only.`,
        },
      ],
    });

    const rawText = aiResponse.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // ── 4. Parse the response as JSON ─────────────────────────
    let program;
    try {
      // Strip any accidental markdown fences Claude may include
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      program = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[GenProgram] Failed to parse Claude response as JSON:', parseErr.message);
      console.error('[GenProgram] Raw response (first 500 chars):', rawText.slice(0, 500));
      return res.status(500).json({ error: 'AI returned invalid JSON — please retry' });
    }

    // ── 5. Safety validation ──────────────────────────────────
    const gender = intake?.gender?.toLowerCase() || 'female';
    const safetyIssues = validateSafety(program, gender);

    if (safetyIssues.length > 0) {
      console.error(`[GenProgram] Safety check FAILED for client ${client_id}:`, safetyIssues);

      await createEscalation({
        phone: client.phone,
        clientId: client_id,
        reason: `AI program safety violation: ${safetyIssues.join('; ')}`,
        messageBody: `Week ${weekNumber} program generation blocked. Issues: ${safetyIssues.join('; ')}`,
      });

      return res.status(422).json({
        error: 'Program failed safety review',
        issues: safetyIssues,
      });
    }

    console.log(`[GenProgram] Safety check passed for client ${client_id}, week ${weekNumber}`);

    // ── 6. Generate branded PDF ───────────────────────────────
    const clientName = client.name || 'Client';
    const weekFocus = program.week_focus || null;
    const workoutPlan = program.workout_plan || [];
    const nutritionPlan = program.nutrition_plan || {};

    const pdfBuffer = await generatePDF(clientName, weekNumber, weekFocus, workoutPlan, nutritionPlan);

    console.log(`[GenProgram] PDF generated (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    // ── 7. Upload PDF to Supabase Storage ─────────────────────
    const storagePath = `clients/${client_id}/week_${weekNumber}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('programs')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[GenProgram] PDF upload failed:', uploadErr.message);
      return res.status(500).json({ error: 'Failed to upload PDF' });
    }

    const { data: publicUrlData } = supabase.storage
      .from('programs')
      .getPublicUrl(storagePath);

    const pdfUrl = publicUrlData?.publicUrl || null;

    console.log(`[GenProgram] PDF uploaded: ${storagePath}`);

    // ── 8. Insert program record ──────────────────────────────
    const { data: programRecord, error: insertErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: weekNumber,
        pdf_url: pdfUrl,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes: weekFocus,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[GenProgram] Program record insert failed:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save program record' });
    }

    // ── 9. Send via WhatsApp ──────────────────────────────────
    const focusSummary = weekFocus || `Week ${weekNumber} training and nutrition plan`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      params: [clientName, String(weekNumber), focusSummary, pdfUrl],
    });

    // Update whatsapp_sent_at
    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', programRecord.id);

    console.log(`[GenProgram] Week ${weekNumber} program sent to ${maskPhone(client.phone)}`);

    // ── 10. Return success ────────────────────────────────────
    return res.status(200).json({
      ok: true,
      program_id: programRecord.id,
      client_id,
      week_no: weekNumber,
      pdf_url: pdfUrl,
      week_focus: weekFocus,
    });

  } catch (err) {
    console.error(`[GenProgram] Unhandled error for client ${client_id}:`, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
