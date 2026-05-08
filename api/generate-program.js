const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');

const SAFETY_FLAGS = [
  { pattern: /(\d{3,4})\s*cal/i, check: (m) => parseInt(m[1], 10) < 1000, reason: 'extreme calorie restriction (<1000 cal)' },
  { pattern: /stero|clenbuterol|dnp|ephedra|sarm/i, check: () => true, reason: 'banned/dangerous substance mentioned' },
  { pattern: /lose\s+(\d+)\s*(kg|lb|pound)/i, check: (m) => parseInt(m[1], 10) > (m[2] === 'kg' ? 5 : 11), reason: 'unrealistic weekly weight loss target' },
];

function checkSafety(text) {
  for (const flag of SAFETY_FLAGS) {
    const match = text.match(flag.pattern);
    if (match && flag.check(match)) {
      return { safe: false, reason: flag.reason };
    }
  }
  return { safe: true, reason: null };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate internal authorization
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!process.env.INTERNAL_API_SECRET || token !== process.env.INTERNAL_API_SECRET) {
      console.warn('[generate-program] Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing required fields: client_id, week_no' });
    }

    // Fetch client profile
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*, leads!inner(name, program_interest, market)')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      console.error(`[generate-program] Client not found: ${client_id}`);
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Fetch previous program if exists
    const { data: prevProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .eq('week_no', week_no - 1)
      .single();

    // Build context for Claude
    const clientContext = {
      name: client.name || client.leads?.name || 'Client',
      program: client.program,
      week: week_no,
      recent_checkins: (checkins || []).map((c) => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
      })),
      previous_program: prevProgram
        ? {
            workout_plan: prevProgram.workout_plan,
            nutrition_plan: prevProgram.nutrition_plan,
            notes: prevProgram.notes,
          }
        : null,
    };

    const systemPrompt = `You are "program_architect", an expert fitness program designer for FitnessByMaddy, an online coaching platform. You create personalized weekly training and nutrition programs.

RULES:
- Design safe, evidence-based programs appropriate for the client's level and goals.
- Never recommend calorie intake below 1200 for women or 1500 for men.
- Never recommend banned or dangerous substances.
- Set realistic expectations (0.5-1kg per week fat loss max).
- If the client reported injuries or pain, modify exercises accordingly.
- If compliance was low, simplify the program and focus on adherence.
- If energy was low, reduce training volume slightly and check nutrition.
- Progress the program week over week — don't repeat the exact same plan.

OUTPUT FORMAT:
Respond with valid JSON only, no markdown, no explanation. The JSON must have this structure:
{
  "workout_plan": {
    "summary": "Brief overview of the week's training focus",
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "summary": "Brief nutrition focus for the week",
    "daily_calories": 1800,
    "protein_g": 130,
    "carbs_g": 180,
    "fat_g": 60,
    "meal_timing": "...",
    "hydration": "...",
    "supplements": ["..."],
    "notes": "..."
  },
  "coach_notes": "Any notes for the coach about this program"
}`;

    const userMessage = `Generate Week ${week_no} program for the following client:

${JSON.stringify(clientContext, null, 2)}

Respond with JSON only.`;

    // Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Parse the JSON response
    let programData;
    try {
      programData = JSON.parse(responseText);
    } catch (parseErr) {
      // Try extracting JSON from markdown code block
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[1].trim());
      } else {
        console.error('[generate-program] Failed to parse Claude response as JSON');
        return res.status(500).json({ error: 'Failed to parse program data' });
      }
    }

    // Safety check
    const safetyResult = checkSafety(responseText);
    const flaggedForReview = !safetyResult.safe;

    if (flaggedForReview) {
      console.warn(
        `[generate-program] SAFETY FLAG for client ${maskPhone(client.phone)}: ${safetyResult.reason}`
      );
    }

    // Insert into programs table
    const { data: insertedProgram, error: insertErr } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan || null,
        nutrition_plan: programData.nutrition_plan || null,
        notes: programData.coach_notes || null,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error(`[generate-program] Insert failed:`, insertErr.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    console.log(
      `[generate-program] Week ${week_no} generated for client ${maskPhone(client.phone)} ` +
      `(program_id=${insertedProgram.id}, flagged=${flaggedForReview})`
    );

    // Send program summary via WhatsApp (only if safe)
    if (!flaggedForReview) {
      const workoutSummary = programData.workout_plan?.summary || 'Your new workout plan is ready!';
      const nutritionSummary = programData.nutrition_plan?.summary || '';
      const summaryMsg =
        `Week ${week_no} Program Ready!\n\n` +
        `Training: ${workoutSummary}\n` +
        (nutritionSummary ? `Nutrition: ${nutritionSummary}\n\n` : '\n') +
        `Calories: ${programData.nutrition_plan?.daily_calories || 'TBD'} | ` +
        `Protein: ${programData.nutrition_plan?.protein_g || 'TBD'}g\n\n` +
        `Full details are in your client portal. Let's crush this week!`;

      await sendMessage(client.phone, summaryMsg);
    }

    return res.status(200).json({
      success: true,
      program_id: insertedProgram.id,
      flagged_for_review: flaggedForReview,
      flag_reason: safetyResult.reason,
      program: programData,
    });
  } catch (err) {
    console.error('[generate-program] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
