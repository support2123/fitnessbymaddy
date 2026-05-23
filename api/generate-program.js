// POST /api/generate-program
// Generates a weekly training program for a client using Claude AI,
// stores it in Supabase, and sends a summary via WhatsApp.

const Anthropic = require('anthropic');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { createEscalation } = require('./lib/escalation');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

// Banned substances that should never appear in a program
const BANNED_SUBSTANCES = ['steroid', 'dnp', 'clenbuterol', 'ephedra', 'sarm', 'anavar', 'winstrol', 'trenbolone', 'dianabol'];

// Keywords that may indicate dangerous advice for injury-prone clients
const INJURY_RISK_KEYWORDS = ['heavy squat', 'max lift', 'explosive jump', 'high impact', 'sprint'];

const SYSTEM_PROMPT = `You are a NASM-certified fitness program architect for Fitness by Maddy, an elite online coaching brand. You create weekly workout and nutrition plans that are:
- Evidence-based and progressive
- Tailored to the client's current stats, goals, and feedback
- Safe (never prescribe extreme calorie deficits below 1200cal for women or 1500cal for men, never recommend banned substances, never promise unrealistic timelines)
- Written in a warm, professional tone

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": { "type": "LISS", "duration": "20min" }
      }
    ],
    "rest_days": ["Wednesday", "Sunday"],
    "notes": "Progressive overload focus this week"
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 73,
    "meal_framework": [
      { "meal": "Breakfast", "example": "4 egg whites + 1 whole egg + oats + banana", "macros": "P: 30g C: 50g F: 10g" }
    ],
    "hydration": "3-4L water daily",
    "supplements": ["Whey protein post-workout", "Creatine 5g daily"],
    "notes": "Slight deficit for fat loss phase"
  },
  "weekly_focus": "Focus on progressive overload on compound lifts. Increase bench and squat by 2.5kg if last week's sets were completed with good form.",
  "motivation": "Great progress on compliance last week! Keep that energy going."
}`;

function buildUserPrompt(client, checkins, prevProgram, weekNo) {
  const lines = [];

  lines.push(`Client: ${client.name}`);
  lines.push(`Program: ${client.program || 'Custom'}`);
  lines.push(`Week Number: ${weekNo}`);

  // Intake / profile data
  const intake = client.intake || {};
  if (intake.goal || client.goal) lines.push(`Goal: ${intake.goal || client.goal}`);
  if (intake.training_location) lines.push(`Training Location: ${intake.training_location}`);
  if (intake.experience_level) lines.push(`Experience Level: ${intake.experience_level}`);
  if (intake.diet_preference) lines.push(`Diet Preference: ${intake.diet_preference}`);
  if (intake.gender || client.gender) lines.push(`Gender: ${intake.gender || client.gender}`);
  if (intake.injuries || client.injuries) lines.push(`Injuries / Limitations: ${intake.injuries || client.injuries}`);

  lines.push('');
  lines.push('--- Recent Check-ins (most recent first) ---');

  if (checkins && checkins.length > 0) {
    checkins.forEach((c, i) => {
      lines.push(`Check-in Week ${c.week_no}:`);
      if (c.weight != null) lines.push(`  Weight: ${c.weight}kg`);
      if (c.compliance_score != null) lines.push(`  Compliance: ${c.compliance_score}/10`);
      if (c.energy != null) lines.push(`  Energy: ${c.energy}/10`);
      if (c.issues) lines.push(`  Issues: ${c.issues}`);
      if (c.next_week_focus) lines.push(`  Notes/Adjustments: ${c.next_week_focus}`);
    });
  } else {
    lines.push('No previous check-ins available.');
  }

  lines.push('');
  lines.push('--- Previous Week Program Summary ---');

  if (prevProgram) {
    const wp = prevProgram.workout_plan || {};
    const np = prevProgram.nutrition_plan || {};
    if (wp.notes) lines.push(`Workout Notes: ${wp.notes}`);
    if (np.calories) lines.push(`Previous Calories: ${np.calories}`);
    if (np.protein_g) lines.push(`Previous Protein: ${np.protein_g}g`);
    const trainingDays = (wp.days || []).map((d) => d.day).join(', ');
    if (trainingDays) lines.push(`Training Days: ${trainingDays}`);
    if (prevProgram.weekly_focus) lines.push(`Last Week Focus: ${prevProgram.weekly_focus}`);
  } else {
    lines.push('No previous program — this is the first week.');
  }

  lines.push('');
  lines.push('Please generate a complete Week ' + weekNo + ' program. Output ONLY the JSON object, no markdown fences or explanatory text.');

  return lines.join('\n');
}

function validateProgram(parsed, client) {
  const issues = [];

  // Check calories
  const calories = parsed.nutrition_plan?.calories;
  if (typeof calories === 'number') {
    if (calories < 1000 || calories > 5000) {
      issues.push(`Extreme calorie target: ${calories}`);
    } else {
      // Gender-specific minimums
      const gender = (client.gender || client.intake?.gender || '').toLowerCase();
      if (gender === 'female' && calories < 1200) {
        issues.push(`Calorie target ${calories} is below the 1200 minimum for women`);
      }
      if (gender === 'male' && calories < 1500) {
        issues.push(`Calorie target ${calories} is below the 1500 minimum for men`);
      }
    }
  }

  // Stringify the full plan for text scanning
  const planText = JSON.stringify(parsed).toLowerCase();

  // Check for banned substances
  for (const substance of BANNED_SUBSTANCES) {
    if (planText.includes(substance)) {
      issues.push(`Banned substance detected: "${substance}"`);
    }
  }

  // Check for injury-risk keywords against reported injuries
  const injuries = (client.injuries || client.intake?.injuries || '').toLowerCase();
  if (injuries) {
    for (const kw of INJURY_RISK_KEYWORDS) {
      if (planText.includes(kw)) {
        issues.push(`Potentially dangerous exercise ("${kw}") for a client with reported injuries: "${injuries}"`);
        break; // Only flag once
      }
    }
  }

  return issues;
}

function buildWhatsAppSummary(parsed, weekNo, programLink) {
  const wp = parsed.workout_plan || {};
  const np = parsed.nutrition_plan || {};

  const trainingDays = (wp.days || []).length;
  const exerciseCount = (wp.days || []).reduce((sum, d) => sum + (d.exercises || []).length, 0);
  const calories = np.calories || '—';
  const focus = parsed.weekly_focus || wp.notes || 'Progressive overload';

  const summary = [
    `Week ${weekNo} Program Ready! 💪`,
    `Focus: ${focus}`,
    `${exerciseCount} exercises across ${trainingDays} training days.`,
    `Calories: ${calories} kcal.`,
    programLink ? `Check your program: ${programLink}` : null
  ]
    .filter(Boolean)
    .join('\n');

  return summary;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic auth: only allow calls with the internal CRON_SECRET
  const authHeader = req.headers.authorization || '';
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { client_id, week_no } = req.body || {};

  if (!client_id || week_no == null) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const weekNumber = parseInt(week_no, 10);
  if (isNaN(weekNumber) || weekNumber < 1) {
    return res.status(400).json({ error: 'week_no must be a positive integer' });
  }

  try {
    // ----------------------------------------------------------------
    // 1. Fetch client (with intake data if stored on the row)
    // ----------------------------------------------------------------
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, phone, program, status, gender, goal, injuries, intake')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      console.error('Client not found:', client_id, clientError?.message);
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      console.log(`Program generation skipped — client not active: ${maskPhone(client.phone)}`);
      return res.status(403).json({ error: 'Client account is not active' });
    }

    // ----------------------------------------------------------------
    // 2. Fetch last 2 check-ins (most recent first)
    // ----------------------------------------------------------------
    const { data: checkins } = await supabase
      .from('checkins')
      .select('week_no, weight, compliance_score, energy, issues, next_week_focus')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // ----------------------------------------------------------------
    // 3. Fetch most recent existing program (for continuity)
    // ----------------------------------------------------------------
    const { data: prevPrograms } = await supabase
      .from('programs')
      .select('id, week_no, workout_plan, nutrition_plan, weekly_focus')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1);

    const prevProgram = prevPrograms && prevPrograms.length > 0
      ? { ...prevPrograms[0].workout_plan && prevPrograms[0] }
      : null;

    // Flatten for easier access in buildUserPrompt
    const prevProgramData = prevPrograms?.[0]
      ? {
          workout_plan: prevPrograms[0].workout_plan,
          nutrition_plan: prevPrograms[0].nutrition_plan,
          weekly_focus: prevPrograms[0].weekly_focus
        }
      : null;

    // ----------------------------------------------------------------
    // 4 & 5. Build prompts and call Claude
    // ----------------------------------------------------------------
    const userPrompt = buildUserPrompt(client, checkins || [], prevProgramData, weekNumber);

    console.log(`Calling Claude for ${maskPhone(client.phone)}, week ${weekNumber}`);

    let claudeText;
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      });
      claudeText = response.content?.[0]?.text || '';
    } catch (claudeErr) {
      console.error('Claude API error:', claudeErr.message);
      return res.status(502).json({ error: 'Program generation failed — AI service unavailable', detail: claudeErr.message });
    }

    // ----------------------------------------------------------------
    // 6. Parse and validate the Claude response
    // ----------------------------------------------------------------
    let parsed;
    try {
      // Strip markdown fences if Claude added them despite instructions
      const jsonText = claudeText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON:', parseErr.message);
      console.error('Raw response:', claudeText.slice(0, 500));

      await createEscalation(
        client.phone,
        'program_parse_failure',
        `Claude returned invalid JSON for week ${weekNumber}: ${claudeText.slice(0, 200)}`,
        client_id
      );

      return res.status(502).json({ error: 'Program generation failed — could not parse AI response' });
    }

    // Safety validation
    const validationIssues = validateProgram(parsed, client);
    if (validationIssues.length > 0) {
      const issueText = validationIssues.join('; ');
      console.warn(`Safety validation failed for ${maskPhone(client.phone)}: ${issueText}`);

      await createEscalation(
        client.phone,
        'program_safety_failure',
        `Week ${weekNumber} program failed safety checks: ${issueText}`,
        client_id
      );

      return res.status(422).json({ error: 'Program did not pass safety validation', issues: validationIssues });
    }

    // ----------------------------------------------------------------
    // 7. Store program in programs table
    // ----------------------------------------------------------------
    const programRow = {
      client_id,
      week_no: weekNumber,
      workout_plan: parsed.workout_plan || null,
      nutrition_plan: parsed.nutrition_plan || null,
      notes: [parsed.weekly_focus, parsed.motivation].filter(Boolean).join('\n\n') || null
    };

    // Upsert: update if a program already exists for this week
    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNumber)
      .maybeSingle();

    let programId;
    if (existingProgram) {
      const { data: updated, error: updateErr } = await supabase
        .from('programs')
        .update(programRow)
        .eq('id', existingProgram.id)
        .select('id')
        .single();

      if (updateErr) {
        console.error('Failed to update program:', updateErr.message);
        return res.status(500).json({ error: 'Failed to save program' });
      }
      programId = updated.id;
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('programs')
        .insert(programRow)
        .select('id')
        .single();

      if (insertErr) {
        console.error('Failed to insert program:', insertErr.message);
        return res.status(500).json({ error: 'Failed to save program' });
      }
      programId = inserted.id;
    }

    console.log(`Program stored: id=${programId}, client=${maskPhone(client.phone)}, week=${weekNumber}`);

    // ----------------------------------------------------------------
    // 8 & 9. Build WhatsApp summary and send
    // ----------------------------------------------------------------
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.APP_URL || '';

    const programLink = baseUrl ? `${baseUrl}/program/${programId}` : '';
    const summary = buildWhatsAppSummary(parsed, weekNumber, programLink);

    const whatsappResult = await sendWhatsApp(
      client.phone,
      'weekly_program',
      [
        String(weekNumber),
        parsed.weekly_focus || 'Progressive overload',
        String((parsed.workout_plan?.days || []).reduce((n, d) => n + (d.exercises || []).length, 0)),
        String((parsed.workout_plan?.days || []).length),
        String(parsed.nutrition_plan?.calories || ''),
        programLink || 'your coaching portal'
      ],
      true // isClient — bypass rate limiting
    );

    console.log(`WhatsApp send result for ${maskPhone(client.phone)}: ${whatsappResult.success ? 'ok' : whatsappResult.reason}`);

    // ----------------------------------------------------------------
    // 10. Update program record with whatsapp_sent_at
    // ----------------------------------------------------------------
    if (whatsappResult.success) {
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', programId);
    }

    // ----------------------------------------------------------------
    // 11. Return success
    // ----------------------------------------------------------------
    return res.status(200).json({
      success: true,
      program_id: programId,
      week_no: weekNumber
    });
  } catch (err) {
    console.error('generate-program unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
