const { query, insert, update, uploadFile } = require("./lib/supabase");
const { sendTemplate, maskPhone } = require("./lib/whatsapp");

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const MADDY_PHONE = process.env.MADDY_PHONE;

const CALORIE_FLOOR = 1200;

/**
 * POST /api/generate-program
 * Generates a weekly program via Claude API for a given client/week.
 * Protected by INTERNAL_API_KEY.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${INTERNAL_API_KEY}`) {
      console.warn("[generate-program] Unauthorized request");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { client_id, week_no } = req.body || {};
    if (!client_id || !week_no) {
      return res.status(400).json({ error: "client_id and week_no are required" });
    }

    console.log(`[generate-program] Starting for client=${client_id} week=${week_no}`);

    // ── Fetch client profile ────────────────────────────────────────
    const clients = await query("clients", {
      select: "*",
      filters: { id: `eq.${client_id}` },
      limit: 1,
    });

    const client = clients[0];
    if (!client) {
      console.error(`[generate-program] Client not found: ${client_id}`);
      return res.status(404).json({ error: "Client not found" });
    }

    let lead = {};
    if (client.lead_id) {
      const leads = await query("leads", {
        select: "name, phone, market, program_interest, profile",
        filters: { id: `eq.${client.lead_id}` },
        limit: 1,
      });
      lead = leads[0] || {};
    }
    const phone = client.phone || lead.phone;
    console.log(
      `[generate-program] Client found: ${maskPhone(phone || "unknown")} program=${client.program}`
    );

    // ── Fetch last 2 check-ins ──────────────────────────────────────
    const checkins = await query("checkins", {
      select: "*",
      filters: { client_id: `eq.${client_id}` },
      order: "week_no.desc",
      limit: 2,
    });

    // ── Build Claude prompt ─────────────────────────────────────────
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, lead, checkins, week_no);

    console.log(`[generate-program] Calling Claude API for client=${client_id} week=${week_no}`);

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error(`[generate-program] Claude API error (${claudeRes.status}): ${errBody}`);
      return res.status(502).json({ error: "Program generation failed. Please retry." });
    }

    const claudeData = await claudeRes.json();
    const rawContent = claudeData.content?.[0]?.text || "";

    // ── Parse the JSON from Claude's response ───────────────────────
    let program;
    try {
      program = extractJSON(rawContent);
    } catch (parseErr) {
      console.error("[generate-program] Failed to parse Claude response as JSON:", parseErr.message);
      console.error("[generate-program] Raw response (first 500 chars):", rawContent.slice(0, 500));
      return res.status(502).json({ error: "Program generation returned invalid format." });
    }

    const { workout_plan, nutrition_plan, notes } = program;

    // ── Safety validation ───────────────────────────────────────────
    const safetyFlags = validateSafety(program);
    const needsReview = safetyFlags.length > 0;

    if (needsReview) {
      console.warn(
        `[generate-program] SAFETY FLAGS for client=${client_id}: ${safetyFlags.join(", ")}`
      );
    }

    // ── Store in programs table ─────────────────────────────────────
    const programRecord = {
      client_id,
      week_no: parseInt(week_no, 10),
      workout_plan,
      nutrition_plan,
      notes: notes || null,
      needs_review: needsReview,
      safety_flags: safetyFlags.length > 0 ? safetyFlags : null,
      created_at: new Date().toISOString(),
    };

    const [inserted] = await insert("programs", programRecord);
    const programId = inserted?.id;
    console.log(
      `[generate-program] Program saved id=${programId} needs_review=${needsReview}`
    );

    // ── Upload text summary to storage ──────────────────────────────
    const summary = buildTextSummary(program, client, week_no);
    try {
      await uploadFile(
        "programs",
        `clients/${client_id}/program_w${week_no}_summary.txt`,
        Buffer.from(summary, "utf-8"),
        "text/plain"
      );
      console.log(`[generate-program] Summary uploaded for client=${client_id} week=${week_no}`);
    } catch (uploadErr) {
      console.error("[generate-program] Summary upload failed:", uploadErr.message);
    }

    // ── If flagged, notify Maddy and stop (don't auto-send) ─────────
    if (needsReview) {
      try {
        const { sendText } = require("./lib/whatsapp");
        await sendText(
          MADDY_PHONE,
          `⚠️ REVIEW NEEDED — Program for client ${client_id} (week ${week_no}) was flagged:\n\n${safetyFlags.join("\n")}\n\nPlease review before sending.`
        );
      } catch (notifyErr) {
        console.error("[generate-program] Failed to notify Maddy:", notifyErr.message);
      }

      return res.status(200).json({
        ok: true,
        program_id: programId,
        needs_review: true,
        safety_flags: safetyFlags,
        message: "Program generated but flagged for manual review.",
      });
    }

    // ── Send via WhatsApp ───────────────────────────────────────────
    const contextLine = buildContextLine(program, week_no);

    try {
      await sendTemplate(phone, "weekly_program", [contextLine]);
      console.log(
        `[generate-program] WhatsApp sent to ${maskPhone(phone)} for week ${week_no}`
      );

      // Update sent timestamp
      if (programId) {
        await update(
          "programs",
          { id: `eq.${programId}` },
          { whatsapp_sent_at: new Date().toISOString() }
        );
      }
    } catch (sendErr) {
      console.error(
        `[generate-program] WhatsApp send failed for ${maskPhone(phone)}:`,
        sendErr.message
      );
      // Program is saved even if WhatsApp fails -- can be retried
    }

    return res.status(200).json({
      ok: true,
      program_id: programId,
      needs_review: false,
      message: "Program generated and sent successfully.",
    });
  } catch (err) {
    console.error("[generate-program] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── Prompt builders ───────────────────────────────────────────────────

function buildSystemPrompt() {
  return `You are "program_architect", an expert fitness and nutrition coach assistant for FitnessByMaddy, a premium women's fitness coaching service.

Your job is to generate a personalised weekly training and nutrition program based on the client's profile and recent check-in data.

SAFETY RAILS — you MUST follow these:
- Never prescribe calorie intake below ${CALORIE_FLOOR} kcal/day for any client.
- Never recommend banned or controlled substances, fat burners, or unregulated supplements.
- Never make unrealistic promises (e.g. "lose 10kg in 1 week").
- If a client reports pain, dizziness, injury, or medical conditions, include a note recommending they consult their doctor and flag it clearly.
- Respect the client's stated injuries, limitations, and dietary preferences.

OUTPUT FORMAT — respond with ONLY a valid JSON object (no markdown, no code fences) with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "exercises": [
          {
            "name": "Dumbbell Bench Press",
            "sets": 4,
            "reps": "8-10",
            "rest_seconds": 90,
            "notes": "optional form cues"
          }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros": { "protein_g": 130, "carbs_g": 180, "fat_g": 60 },
    "meal_timing": ["Meal 1: 8am", "Meal 2: 12pm", "Meal 3: 4pm", "Meal 4: 8pm"],
    "sample_meals": [
      { "meal": "Meal 1", "description": "Oats with protein powder, banana, almond butter" }
    ],
    "hydration": "Minimum 2.5L water daily",
    "supplements": ["Whey protein", "Multivitamin"]
  },
  "notes": "Coach observations, encouragements, and any medical disclaimers."
}`;
}

function buildUserPrompt(client, lead, checkins, weekNo) {
  const leadProfile = lead.profile || {};
  const profile = {
    name: lead.name || client.name || "Client",
    age: leadProfile.age || "unknown",
    goal: leadProfile.goal || lead.program_interest || "general fitness",
    program: client.program || "6wk_gym",
    injuries: leadProfile.injuries || "none reported",
    diet_preferences: leadProfile.diet_pref || "no restrictions",
    equipment_access: leadProfile.current_fitness || "full gym",
    market: lead.market || "GLOBAL",
  };

  const checkinSummary = checkins.map((ci) => ({
    week: ci.week_no,
    weight: ci.weight,
    waist: ci.waist,
    compliance: ci.compliance_score,
    energy: ci.energy,
    issues: ci.issues || "none",
  }));

  let trends = "";
  if (checkins.length >= 2) {
    const latest = checkins[0];
    const previous = checkins[1];
    const weightChange = latest.weight && previous.weight
      ? (latest.weight - previous.weight).toFixed(1)
      : "N/A";
    trends = `Weight trend: ${weightChange}kg. Compliance: ${latest.compliance_score}/10 (prev: ${previous.compliance_score}/10). Energy: ${latest.energy}/10 (prev: ${previous.energy}/10).`;
  } else if (checkins.length === 1) {
    const ci = checkins[0];
    trends = `First check-in data: weight=${ci.weight}kg, compliance=${ci.compliance_score}/10, energy=${ci.energy}/10.`;
  } else {
    trends = "No check-in data yet — this is the initial program.";
  }

  return `Generate the WEEK ${weekNo} program for this client.

CLIENT PROFILE:
- Name: ${profile.name}
- Age: ${profile.age}
- Goal: ${profile.goal}
- Program: ${profile.program}
- Injuries/limitations: ${profile.injuries}
- Diet preferences: ${profile.diet_preferences}
- Equipment: ${profile.equipment_access}

RECENT CHECK-IN DATA:
${JSON.stringify(checkinSummary, null, 2)}

TRENDS:
${trends}

Please generate the complete week ${weekNo} program. Adjust intensity and nutrition based on the check-in trends. If compliance is low, simplify. If energy is low, check recovery and nutrition. If weight is stalling, consider adjusting macros.

Remember: output ONLY the JSON object, no other text.`;
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (_) {
    // noop
  }

  // Try extracting from code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1].trim());
  }

  // Try finding first { to last }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }

  throw new Error("No valid JSON found in response");
}

function validateSafety(program) {
  const flags = [];

  // Check calorie floor
  const calories = program.nutrition_plan?.daily_calories;
  if (typeof calories === "number" && calories < CALORIE_FLOOR) {
    flags.push(`Calorie intake too low: ${calories} kcal (minimum ${CALORIE_FLOOR})`);
  }

  // Check for banned substance keywords
  const banned = [
    "clenbuterol", "dnp", "ephedra", "sibutramine",
    "anabolic", "steroid", "sarm", "growth hormone",
    "fat burner", "thermogenic",
  ];
  const planText = JSON.stringify(program).toLowerCase();
  for (const term of banned) {
    if (planText.includes(term)) {
      flags.push(`Banned/flagged substance reference: "${term}"`);
    }
  }

  // Check for unrealistic promises in notes
  const unrealistic = [
    "lose 10kg in", "lose 20lb in", "guaranteed",
    "100% results", "miracle",
  ];
  const notesLower = (program.notes || "").toLowerCase();
  for (const phrase of unrealistic) {
    if (notesLower.includes(phrase)) {
      flags.push(`Unrealistic claim in notes: "${phrase}"`);
    }
  }

  // Check protein is not absurdly high (> 3g/kg for a hypothetical 120kg person = 360g)
  const proteinG = program.nutrition_plan?.macros?.protein_g;
  if (typeof proteinG === "number" && proteinG > 360) {
    flags.push(`Protein intake unusually high: ${proteinG}g`);
  }

  return flags;
}

function buildTextSummary(program, client, weekNo) {
  const lines = [];
  lines.push(`FITNESSBYMADDY — WEEKLY PROGRAM`);
  lines.push(`Client: ${client.name || client.id}`);
  lines.push(`Week: ${weekNo}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`${"=".repeat(50)}`);
  lines.push("");

  // Workout summary
  lines.push("WORKOUT PLAN");
  lines.push("-".repeat(30));
  const days = program.workout_plan?.days || [];
  for (const day of days) {
    lines.push(`${day.day} — ${day.focus || "General"}`);
    for (const ex of day.exercises || []) {
      lines.push(`  • ${ex.name}: ${ex.sets}x${ex.reps} (rest: ${ex.rest_seconds}s)${ex.notes ? ` — ${ex.notes}` : ""}`);
    }
    lines.push("");
  }

  // Nutrition summary
  lines.push("NUTRITION PLAN");
  lines.push("-".repeat(30));
  const np = program.nutrition_plan || {};
  lines.push(`Calories: ${np.daily_calories || "N/A"} kcal/day`);
  if (np.macros) {
    lines.push(`Macros: P${np.macros.protein_g}g / C${np.macros.carbs_g}g / F${np.macros.fat_g}g`);
  }
  if (np.hydration) lines.push(`Hydration: ${np.hydration}`);
  lines.push("");

  // Notes
  if (program.notes) {
    lines.push("COACH NOTES");
    lines.push("-".repeat(30));
    lines.push(program.notes);
  }

  return lines.join("\n");
}

function buildContextLine(program, weekNo) {
  const np = program.nutrition_plan || {};
  const dayCount = program.workout_plan?.days?.length || 0;
  return `Week ${weekNo} program ready: ${dayCount}-day split, ${np.daily_calories || "~"}kcal target. Let's go!`;
}
