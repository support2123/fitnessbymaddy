const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { generateProgramPDF } = require('./_lib/pdf');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

const BANNED_TERMS = [
  'steroid',
  'anabolic',
  'clenbuterol',
  'dnp',
  'dinitrophenol',
  'ephedra',
  'sarm',
  'hgh injection',
  'testosterone injection',
  'crash diet',
  'lose 10 kg in a week',
  'lose 20 pounds in a week',
  'extreme fasting',
  'water fast',
  'zero calorie',
];

/**
 * Scan the generated program for unsafe recommendations.
 * Returns { safe: boolean, reasons: string[] }
 */
function safetyCheck(programData) {
  const reasons = [];
  const text = JSON.stringify(programData).toLowerCase();

  // Check for banned substances / terms
  for (const term of BANNED_TERMS) {
    if (text.includes(term)) {
      reasons.push(`Contains banned term: "${term}"`);
    }
  }

  // Check for dangerously low calories
  if (programData.nutrition_plan && programData.nutrition_plan.calories) {
    const cals = parseInt(programData.nutrition_plan.calories, 10);
    if (!isNaN(cals) && cals < 1000) {
      reasons.push(`Calorie target dangerously low: ${cals} kcal`);
    }
  }

  // Check meal-level calories for extremely low totals
  if (programData.nutrition_plan && Array.isArray(programData.nutrition_plan.meals)) {
    let totalMealCals = 0;
    for (const meal of programData.nutrition_plan.meals) {
      const mealCal = parseInt(meal.calories, 10);
      if (!isNaN(mealCal)) totalMealCals += mealCal;
    }
    if (totalMealCals > 0 && totalMealCals < 1000) {
      reasons.push(`Total meal calories dangerously low: ${totalMealCals} kcal`);
    }
  }

  return {
    safe: reasons.length === 0,
    reasons,
  };
}

/**
 * Core generation logic -- can be called internally from other modules.
 * Returns { success, program_id?, error?, flagged? }
 */
async function generateProgram(clientId, weekNo) {
  // ── Fetch client profile ──────────────────────────────────────────
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .maybeSingle();

  if (clientErr) {
    throw new Error(`Client lookup failed: ${clientErr.message}`);
  }

  if (!client) {
    throw new Error('Client not found');
  }

  // ── Fetch last 2 check-ins ────────────────────────────────────────
  const { data: checkins, error: checkinErr } = await supabase
    .from('checkins')
    .select('*')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (checkinErr) {
    console.error(`Check-in fetch failed for client ${clientId}:`, checkinErr.message);
  }

  const recentCheckins = checkins || [];

  // ── Build Claude API prompt ───────────────────────────────────────
  const clientSummary = {
    name: client.name,
    program_type: client.program_type || 'general',
    current_week: weekNo,
    goal: client.goal || client.metadata?.goal || 'general fitness',
    injuries: client.metadata?.injuries || 'none reported',
    medical_conditions: client.metadata?.medical_conditions || 'none reported',
    diet_preference: client.metadata?.diet_preference || 'no preference',
    fitness_level: client.metadata?.current_fitness_level || 'intermediate',
    age: client.metadata?.age || null,
  };

  const checkinSummary = recentCheckins.map((c) => ({
    week: c.week_no,
    weight: c.weight,
    waist: c.waist,
    compliance_score: c.compliance_score,
    energy: c.energy,
    issues: c.issues || 'none',
  }));

  const systemPrompt = [
    'You are a NASM-certified fitness program architect.',
    'Generate a week of training and nutrition for the client based on their profile and recent check-in data.',
    'Output valid JSON only -- no markdown, no code fences, no commentary.',
    'The JSON must have exactly this structure:',
    '{',
    '  "workout_plan": {',
    '    "monday": { "focus": "...", "exercises": ["..."] },',
    '    "tuesday": { "focus": "...", "exercises": ["..."] },',
    '    "wednesday": { "focus": "...", "exercises": ["..."] },',
    '    "thursday": { "focus": "...", "exercises": ["..."] },',
    '    "friday": { "focus": "...", "exercises": ["..."] },',
    '    "saturday": { "focus": "...", "exercises": ["..."] },',
    '    "sunday": { "focus": "...", "exercises": ["..."] }',
    '  },',
    '  "nutrition_plan": {',
    '    "calories": <number>,',
    '    "protein": <number in grams>,',
    '    "meals": [',
    '      { "meal": "...", "foods": "...", "calories": <number>, "protein": <number> }',
    '    ]',
    '  },',
    '  "notes": "..."',
    '}',
  ].join('\n');

  const userPrompt = [
    `Client Profile: ${JSON.stringify(clientSummary)}`,
    '',
    `Recent Check-in Data: ${JSON.stringify(checkinSummary)}`,
    '',
    `Generate the program for Week ${weekNo}. Adjust intensity and nutrition based on the check-in trends.`,
    'If the client reported issues, address them in the notes and adjust exercises accordingly.',
    'Ensure calorie targets are safe and sustainable (minimum 1200 kcal for women, 1500 kcal for men).',
  ].join('\n');

  // ── Call Claude API ───────────────────────────────────────────────
  const claudeResponse = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    }),
  });

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text();
    throw new Error(`Claude API error ${claudeResponse.status}: ${errText}`);
  }

  const claudeResult = await claudeResponse.json();

  // Extract text content from Claude response
  const textBlock = (claudeResult.content || []).find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('Claude API returned no text content');
  }

  // ── Parse the JSON response ───────────────────────────────────────
  let programData;
  try {
    // Strip potential markdown code fences
    let rawText = textBlock.text.trim();
    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    programData = JSON.parse(rawText);
  } catch (parseErr) {
    throw new Error(`Failed to parse Claude response as JSON: ${parseErr.message}`);
  }

  // ── Safety check ──────────────────────────────────────────────────
  const safety = safetyCheck(programData);

  if (!safety.safe) {
    // Flag for Maddy review -- do NOT auto-send
    console.warn(
      `Program flagged for client ${clientId} week ${weekNo}: ${safety.reasons.join('; ')}`
    );

    await supabase.from('programs').insert({
      client_id: clientId,
      week_no: weekNo,
      workout_plan: programData.workout_plan || null,
      nutrition_plan: programData.nutrition_plan || null,
      notes: programData.notes || null,
      pdf_url: null,
      generated_at: new Date().toISOString(),
      status: 'flagged',
      flag_reasons: safety.reasons,
    });

    // Notify Maddy
    if (process.env.MADDY_PHONE) {
      await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', {
        userName: 'Maddy',
        templateParams: [
          `Program for ${client.name || maskPhone(client.phone)} (Week ${weekNo}) flagged: ${safety.reasons.join('; ')}`,
          maskPhone(client.phone),
        ],
      }).catch((err) => {
        console.error('Failed to notify Maddy about flagged program:', err.message);
      });
    }

    return { success: false, flagged: true, reasons: safety.reasons };
  }

  // ── Generate branded HTML document ────────────────────────────────
  // Transform workout_plan object into array format expected by generateProgramPDF
  const workoutArray = Object.entries(programData.workout_plan || {}).map(([day, data]) => ({
    day: day.charAt(0).toUpperCase() + day.slice(1),
    focus: data.focus || '',
    exercises: Array.isArray(data.exercises) ? data.exercises : [],
  }));

  const nutritionArray = Array.isArray(programData.nutrition_plan?.meals)
    ? programData.nutrition_plan.meals.map((m) => ({
        meal: m.meal || '',
        foods: m.foods || '',
        calories: m.calories != null ? String(m.calories) : '',
        protein: m.protein != null ? `${m.protein}g` : '',
      }))
    : [];

  const clientDataForPDF = {
    id: clientId,
    name: client.name,
    goal: client.goal || client.metadata?.goal || '',
    notes: programData.notes || '',
  };

  const pdfResult = await generateProgramPDF(clientDataForPDF, weekNo, workoutArray, nutritionArray);

  // ── Insert into programs table ────────────────────────────────────
  const { data: program, error: insertErr } = await supabase
    .from('programs')
    .insert({
      client_id: clientId,
      week_no: weekNo,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes || null,
      pdf_url: pdfResult.publicUrl,
      generated_at: new Date().toISOString(),
      status: 'sent',
    })
    .select('id')
    .single();

  if (insertErr) {
    throw new Error(`Failed to insert program: ${insertErr.message}`);
  }

  // ── Send via WhatsApp ─────────────────────────────────────────────
  if (client.phone) {
    const contextLine = programData.notes
      ? programData.notes.substring(0, 120)
      : `Your Week ${weekNo} program is ready!`;

    await sendTemplate(client.phone, 'weekly_program', {
      userName: client.name || client.phone,
      templateParams: [
        client.name || 'there',
        String(weekNo),
        contextLine,
      ],
      mediaUrl: pdfResult.publicUrl,
    }).catch((err) => {
      console.error(
        `WhatsApp program send failed for ${maskPhone(client.phone)}:`,
        err.message
      );
    });
  }

  return { success: true, program_id: program.id };
}

// ── HTTP Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Auth check ────────────────────────────────────────────────
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    const validTokens = [
      process.env.INTERNAL_API_KEY,
      process.env.CRON_SECRET,
    ].filter(Boolean);

    if (!token || !validTokens.includes(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { client_id, week_no } = req.body || {};

    if (!client_id || week_no == null) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const weekNum = parseInt(week_no, 10);
    if (isNaN(weekNum) || weekNum < 1) {
      return res.status(400).json({ error: 'week_no must be a positive integer' });
    }

    const result = await generateProgram(client_id, weekNum);

    if (result.flagged) {
      return res.status(200).json({
        success: false,
        flagged: true,
        reasons: result.reasons,
        message: 'Program flagged for manual review',
      });
    }

    return res.status(200).json({
      success: true,
      program_id: result.program_id,
    });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Export generateProgram for internal use by other modules
module.exports.generateProgram = generateProgram;
