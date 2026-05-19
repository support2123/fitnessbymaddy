import { createClient } from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { parseBody, cors, maskPhone } from '../lib/helpers.js';

// FLOW E — Weekly Program Generation
// POST { client_id, week_no }

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS = 4000;

const SYSTEM_PROMPT = `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate a personalized weekly training and nutrition plan based on the client's profile, check-in data, and progress. Be evidence-based, progressive, and safe. Never recommend extreme calorie deficits (<1200 for women, <1500 for men), banned substances, or unrealistic timelines. Output valid JSON only.`;

const BANNED_SUBSTANCES = [
  'clenbuterol', 'dnp', 'dinitrophenol', 'ephedra', 'sibutramine',
  'anabolic steroid', 'testosterone enanthate', 'trenbolone', 'stanozolol',
  'hgh', 'human growth hormone', 'sarms', 'rad-140', 'ostarine',
];

export default async function handler(req, res) {
  try {
    // CORS
    if (cors(res)) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── 1. Verify auth ────────────────────────────────────────────
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const validTokens = [process.env.INTERNAL_API_SECRET, process.env.CRON_SECRET].filter(Boolean);

    if (!token || !validTokens.includes(token)) {
      console.warn('[generate-program] Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const supabase = createClient();

    // ── 2. Fetch client record ────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (clientErr || !client) {
      console.error('[generate-program] Client not found:', client_id, clientErr?.message);
      return res.status(404).json({ error: 'Client not found' });
    }

    const masked = maskPhone(client.phone);
    console.log(`[generate-program] Generating week ${week_no} for ${masked}`);

    // ── 3. Fetch last 2 check-ins ─────────────────────────────────
    const { data: checkins, error: checkinErr } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error('[generate-program] Checkin fetch failed:', checkinErr.message);
      // Non-fatal — continue without check-in data
    }

    // ── 4. Build Claude API prompt ────────────────────────────────
    const checkinSummary = (checkins || []).map((ci) => ({
      week_no: ci.week_no,
      weight: ci.weight,
      waist: ci.waist,
      compliance_score: ci.compliance_score,
      energy: ci.energy,
      issues: ci.issues,
      next_week_focus: ci.next_week_focus,
    }));

    const userPrompt = buildUserPrompt(client, week_no, checkinSummary);

    // ── 5. Call Claude API ─────────────────────────────────────────
    const claudeApiKey = process.env.CLAUDE_API_KEY;

    if (!claudeApiKey) {
      console.error('[generate-program] Missing CLAUDE_API_KEY');
      return res.status(500).json({ error: 'Missing API key configuration' });
    }

    let programJson;
    try {
      programJson = await callClaude(claudeApiKey, userPrompt);
    } catch (apiErr) {
      console.error('[generate-program] Claude API call failed:', apiErr.message);
      return res.status(502).json({ error: 'Program generation failed' });
    }

    // ── 6. Safety check ───────────────────────────────────────────
    const safetyResult = runSafetyCheck(programJson, client);
    let notes = null;

    if (safetyResult.flagged) {
      notes = `FLAGGED: ${safetyResult.reasons.join('; ')}`;
      console.warn(`[generate-program] Safety flag for ${masked}: ${notes}`);
    }

    // ── 7. Generate text summary ──────────────────────────────────
    const textSummary = buildTextSummary(programJson, week_no);

    // ── 8. Store in programs table ────────────────────────────────
    const programRecord = {
      client_id,
      week_no,
      workout_plan: programJson.workout_plan || null,
      nutrition_plan: programJson.nutrition_plan || null,
      notes,
      generated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('programs')
      .insert(programRecord)
      .select('id')
      .single();

    if (insertErr) {
      console.error('[generate-program] DB insert failed:', insertErr.message);
      return res.status(500).json({ error: 'Failed to store program' });
    }

    const programId = inserted.id;
    console.log(`[generate-program] Stored program ${programId} for ${masked}`);

    // ── 9. Send WhatsApp (skip if flagged) ────────────────────────
    if (!safetyResult.flagged) {
      const nextFocus = programJson.next_week_focus || 'consistency and progress';
      const whatsappMsg =
        `Your Week ${week_no} program is ready! ` +
        `Focus: ${nextFocus}. ` +
        `Full details in your client portal.`;

      await sendText(client.phone, whatsappMsg).catch((err) => {
        console.error(`[generate-program] WhatsApp send failed for ${masked}:`, err.message);
      });

      // Mark WhatsApp sent time
      await supabase
        .from('programs')
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq('id', programId);
    } else {
      // Notify Maddy about flagged program
      const maddyPhone = process.env.MADDY_PHONE;
      if (maddyPhone) {
        await sendText(
          maddyPhone,
          `Program flagged for review: ${client.name || masked}, week ${week_no}. Reason: ${notes}`
        ).catch((err) => {
          console.error('[generate-program] Maddy notification failed:', err.message);
        });
      }
    }

    // ── 10. Update checkin's next_week_focus ──────────────────────
    if (programJson.next_week_focus) {
      const { error: updateErr } = await supabase
        .from('checkins')
        .update({ next_week_focus: programJson.next_week_focus })
        .eq('client_id', client_id)
        .eq('week_no', week_no);

      if (updateErr) {
        console.warn('[generate-program] Failed to update checkin next_week_focus:', updateErr.message);
      }
    }

    // ── 11. Return ────────────────────────────────────────────────
    console.log(`[generate-program] Completed for ${masked}, program ${programId}`);
    return res.status(200).json({
      success: true,
      program_id: programId,
      flagged: safetyResult.flagged,
    });
  } catch (err) {
    console.error('[generate-program] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────
// Build the user prompt for Claude
// ─────────────────────────────────────────────────────────────────
function buildUserPrompt(client, weekNo, checkinSummary) {
  const profile = {
    program_type: client.program,
    week_number: weekNo,
    name: client.name || 'Client',
  };

  let prompt = `Generate a weekly fitness program for the following client.\n\n`;
  prompt += `## Client Profile\n`;
  prompt += `- Program: ${profile.program_type}\n`;
  prompt += `- Week: ${profile.week_number}\n`;
  prompt += `- Name: ${profile.name}\n`;

  if (checkinSummary.length > 0) {
    prompt += `\n## Recent Check-in Data (most recent first)\n`;
    for (const ci of checkinSummary) {
      prompt += `\n### Week ${ci.week_no}\n`;
      if (ci.weight != null) prompt += `- Weight: ${ci.weight} kg\n`;
      if (ci.waist != null) prompt += `- Waist: ${ci.waist} cm\n`;
      if (ci.compliance_score != null) prompt += `- Compliance: ${ci.compliance_score}/10\n`;
      if (ci.energy != null) prompt += `- Energy: ${ci.energy}/10\n`;
      if (ci.issues) prompt += `- Issues: ${ci.issues}\n`;
      if (ci.next_week_focus) prompt += `- Previous focus: ${ci.next_week_focus}\n`;
    }
  } else {
    prompt += `\nNo previous check-in data available (first week or no submissions yet).\n`;
  }

  prompt += `\n## Required Output Format\n`;
  prompt += `Return ONLY valid JSON with this exact structure:\n`;
  prompt += `{\n`;
  prompt += `  "workout_plan": {\n`;
  prompt += `    "days": [\n`;
  prompt += `      {\n`;
  prompt += `        "day": "Monday",\n`;
  prompt += `        "focus": "Upper Body",\n`;
  prompt += `        "exercises": [\n`;
  prompt += `          { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }\n`;
  prompt += `        ]\n`;
  prompt += `      }\n`;
  prompt += `    ]\n`;
  prompt += `  },\n`;
  prompt += `  "nutrition_plan": {\n`;
  prompt += `    "calories": 1800,\n`;
  prompt += `    "protein": 130,\n`;
  prompt += `    "carbs": 200,\n`;
  prompt += `    "fat": 55,\n`;
  prompt += `    "meals": [\n`;
  prompt += `      { "meal": "Breakfast", "description": "...", "approx_calories": 400 }\n`;
  prompt += `    ]\n`;
  prompt += `  },\n`;
  prompt += `  "coach_notes": "...",\n`;
  prompt += `  "next_week_focus": "..."\n`;
  prompt += `}\n`;

  return prompt;
}

// ─────────────────────────────────────────────────────────────────
// Call Claude API via fetch
// ─────────────────────────────────────────────────────────────────
async function callClaude(apiKey, userPrompt) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => 'unknown');
    throw new Error(`Claude API ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = await response.json();

  // Extract text content from the response
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('Claude API returned no text content');
  }

  const rawText = textBlock.text.trim();

  // Parse JSON — handle potential markdown code fences
  let jsonStr = rawText;
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error('[generate-program] Failed to parse Claude JSON response:', rawText.slice(0, 300));
    throw new Error('Claude returned invalid JSON');
  }
}

// ─────────────────────────────────────────────────────────────────
// Safety check on generated program
// ─────────────────────────────────────────────────────────────────
function runSafetyCheck(programJson, client) {
  const reasons = [];

  // Check calorie minimums
  const calories = programJson.nutrition_plan?.calories;
  if (calories != null) {
    // Default to female minimums (more conservative) unless we know otherwise
    const minCalories = 1200;
    if (calories < minCalories) {
      reasons.push(`Calories too low: ${calories} (min ${minCalories})`);
    }
  }

  // Check for banned substances in the full JSON text
  const jsonText = JSON.stringify(programJson).toLowerCase();
  for (const substance of BANNED_SUBSTANCES) {
    if (jsonText.includes(substance)) {
      reasons.push(`Banned substance mentioned: ${substance}`);
    }
  }

  return {
    flagged: reasons.length > 0,
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────
// Build a readable text summary from the program JSON
// ─────────────────────────────────────────────────────────────────
function buildTextSummary(programJson, weekNo) {
  let text = `=== WEEK ${weekNo} PROGRAM ===\n\n`;

  // Workout summary
  const days = programJson.workout_plan?.days || [];
  if (days.length > 0) {
    text += `WORKOUT PLAN\n`;
    text += `${'-'.repeat(40)}\n`;
    for (const day of days) {
      text += `\n${day.day} — ${day.focus || 'Training'}\n`;
      const exercises = day.exercises || [];
      for (const ex of exercises) {
        text += `  - ${ex.name}: ${ex.sets}x${ex.reps}`;
        if (ex.rest) text += ` (rest ${ex.rest})`;
        if (ex.notes) text += ` — ${ex.notes}`;
        text += `\n`;
      }
    }
  }

  // Nutrition summary
  const nutrition = programJson.nutrition_plan;
  if (nutrition) {
    text += `\nNUTRITION PLAN\n`;
    text += `${'-'.repeat(40)}\n`;
    text += `Calories: ${nutrition.calories || 'N/A'} kcal\n`;
    text += `Protein: ${nutrition.protein || 'N/A'}g | Carbs: ${nutrition.carbs || 'N/A'}g | Fat: ${nutrition.fat || 'N/A'}g\n`;
    const meals = nutrition.meals || [];
    for (const meal of meals) {
      text += `  ${meal.meal}: ${meal.description} (~${meal.approx_calories || '?'} kcal)\n`;
    }
  }

  // Coach notes
  if (programJson.coach_notes) {
    text += `\nCOACH NOTES\n`;
    text += `${'-'.repeat(40)}\n`;
    text += `${programJson.coach_notes}\n`;
  }

  if (programJson.next_week_focus) {
    text += `\nNEXT WEEK FOCUS: ${programJson.next_week_focus}\n`;
  }

  return text;
}
