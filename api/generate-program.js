const Anthropic = require("@anthropic-ai/sdk");
const { supabase } = require("./_lib/supabase");
const { sendText, notifyMaddy } = require("./_lib/whatsapp");
const { respond, parseBody, corsHeaders, maskPhone, validateFields } = require("./_lib/helpers");

/* ── safety checks ── */
const BANNED_TERMS = [
  "steroid", "sarm", "clenbuterol", "dnp", "ephedra", "hgh",
  "testosterone inject", "anavar", "dianabol", "trenbolone",
];

function safetyCheck(program) {
  const issues = [];
  const text = JSON.stringify(program).toLowerCase();

  // Check for dangerously low calories
  const cals = program.nutrition_plan?.calories;
  if (cals && cals < 1000) {
    issues.push(`Extremely low calories: ${cals}`);
  }

  // Check for banned substances
  for (const term of BANNED_TERMS) {
    if (text.includes(term)) {
      issues.push(`Banned substance mention: ${term}`);
    }
  }

  // Check for unrealistic promises
  const unrealistic = [
    "guaranteed", "100% results", "lose 10kg in a week",
    "miracle", "no effort required",
  ];
  for (const phrase of unrealistic) {
    if (text.includes(phrase)) {
      issues.push(`Unrealistic promise: ${phrase}`);
    }
  }

  return issues;
}

/* ── build Claude prompt ── */
function buildPrompt(client, intakeData, checkins, weekNo, totalWeeks) {
  const recentCheckins = checkins
    .map(
      (c) =>
        `Week ${c.week_no}: weight=${c.weight || "N/A"}kg, waist=${c.waist || "N/A"}cm, compliance=${c.compliance_score || "N/A"}/10, energy=${c.energy || "N/A"}/10, issues=${c.issues || "none"}`
    )
    .join("\n");

  return `You are a NASM-certified fitness program architect for FitnessByMaddy. Generate a personalized weekly workout and nutrition plan. Output valid JSON only.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${weekNo} of ${totalWeeks}
- Age: ${intakeData?.age || "unknown"}
- Gender: ${intakeData?.gender || "unknown"}
- Height: ${intakeData?.height || "unknown"}
- Current Weight: ${checkins[0]?.weight || intakeData?.weight || "unknown"}kg
- Goal: ${intakeData?.goal || "general fitness"}
- Injuries/Limitations: ${intakeData?.injuries || "none reported"}
- Diet Preference: ${intakeData?.diet_pref || "no preference"}
- Experience Level: ${intakeData?.experience || "beginner"}
- Equipment Access: ${client.program.includes("home") ? "home equipment only" : "full gym"}

RECENT CHECK-IN DATA:
${recentCheckins || "No previous check-ins (first week)"}

Generate a complete weekly program in this exact JSON format:
{
  "workout_plan": {
    "monday": { "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "10-12", "rest": "60s", "notes": "..."}] },
    "tuesday": { "focus": "...", "exercises": [...] },
    "wednesday": { "focus": "...", "exercises": [...] },
    "thursday": { "focus": "...", "exercises": [...] },
    "friday": { "focus": "...", "exercises": [...] },
    "saturday": { "focus": "...", "exercises": [...] },
    "sunday": { "focus": "Rest / Active Recovery", "exercises": [] }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein": 120,
    "carbs": 180,
    "fats": 60,
    "meals": [
      { "meal": "Breakfast", "description": "...", "calories": 400 },
      { "meal": "Lunch", "description": "...", "calories": 500 },
      { "meal": "Snack", "description": "...", "calories": 200 },
      { "meal": "Dinner", "description": "...", "calories": 500 },
      { "meal": "Post-Workout", "description": "...", "calories": 200 }
    ]
  },
  "coach_notes": "Personalized coaching notes and encouragement for this week..."
}

Important rules:
- Adjust intensity based on week number progression and compliance trends.
- If compliance is low, simplify the plan.
- If client reported issues, address them in coach_notes and adjust exercises.
- Calories must be at least 1200 for women, 1500 for men.
- Never recommend supplements, steroids, or any banned substances.
- Be encouraging but realistic in coach_notes.

Output ONLY the JSON object, no markdown fences, no extra text.`;
}

/* ── format program summary for WhatsApp ── */
function formatSummary(program, weekNo) {
  const wp = program.workout_plan || {};
  const np = program.nutrition_plan || {};

  let summary = `*Week ${weekNo} Program*\n\n`;
  summary += `*Workout Plan:*\n`;

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (const day of days) {
    const d = wp[day];
    if (!d) continue;
    const exerciseCount = d.exercises?.length || 0;
    summary += `${day.charAt(0).toUpperCase() + day.slice(1)}: ${d.focus}${exerciseCount > 0 ? ` (${exerciseCount} exercises)` : ""}\n`;
  }

  summary += `\n*Nutrition Plan:*\n`;
  summary += `Calories: ${np.calories || "N/A"} | Protein: ${np.protein || "N/A"}g | Carbs: ${np.carbs || "N/A"}g | Fats: ${np.fats || "N/A"}g\n`;

  if (np.meals?.length > 0) {
    summary += `\n*Meals:*\n`;
    for (const meal of np.meals) {
      summary += `${meal.meal}: ${meal.description} (~${meal.calories} cal)\n`;
    }
  }

  if (program.coach_notes) {
    summary += `\n*Coach Notes:*\n${program.coach_notes}`;
  }

  return summary;
}

/* ── program total weeks map ── */
const PROGRAM_WEEKS = {
  "6wk_gym": 6,
  "6wk_home": 6,
  "12wk": 12,
  pcos: 6,
  "40plus": 6,
  zoom_trial: 1,
  zoom_pack: 4,
};

module.exports = async function handler(req, res) {
  /* CORS preflight */
  if (req.method === "OPTIONS") {
    const headers = corsHeaders();
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);

    /* ── validate ── */
    const missing = validateFields(body, ["client_id"]);
    if (missing.length > 0) {
      return respond(res, 400, {
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const { client_id } = body;

    /* ── 1. Fetch client profile (join with leads for intake data) ── */
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*, leads(*)")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return respond(res, 404, { error: "Client not found" });
    }

    const intakeData = client.leads || {};
    const totalWeeks = PROGRAM_WEEKS[client.program] || 6;

    /* ── 2. Fetch last 2 check-ins ── */
    const { data: checkins } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    /* ── auto-detect week_no if not provided ── */
    let weekNo = body.week_no;
    if (!weekNo) {
      if (checkins && checkins.length > 0) {
        weekNo = checkins[0].week_no;
      } else {
        weekNo = 1;
      }
    }

    console.log(
      `Generating program: client ${maskPhone(client.phone)}, week ${weekNo}/${totalWeeks}`
    );

    /* ── 3-4. Build prompt & call Claude API ── */
    const prompt = buildPrompt(client, intakeData, checkins || [], weekNo, totalWeeks);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    /* ── 5. Parse JSON response ── */
    const responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    let programData;
    try {
      // Try parsing directly; strip markdown fences if present
      const cleaned = responseText
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      programData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse Claude response:", parseErr.message);
      console.error("Raw response:", responseText.substring(0, 500));
      await notifyMaddy(
        `Program generation failed for ${client.name} (week ${weekNo}): Claude returned invalid JSON. Manual review needed.`
      );
      return respond(res, 500, { error: "Failed to parse generated program" });
    }

    /* ── 6. Safety check ── */
    const safetyIssues = safetyCheck(programData);
    if (safetyIssues.length > 0) {
      console.warn("Safety issues detected:", safetyIssues);

      // Store with flagged status
      await supabase.from("programs").insert({
        client_id,
        week_no: weekNo,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_notes,
        status: "flagged",
        safety_issues: safetyIssues,
      });

      await notifyMaddy(
        `SAFETY FLAG - Program for ${client.name} (week ${weekNo}):\n${safetyIssues.join("\n")}\nPlease review before sending.`
      );

      return respond(res, 200, {
        ok: true,
        flagged: true,
        safety_issues: safetyIssues,
        message: "Program flagged for manual review",
      });
    }

    /* ── 7. Store in programs table ── */
    const { data: programRecord, error: progErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no: weekNo,
        generated_at: new Date().toISOString(),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_notes,
        status: "sent",
      })
      .select("id")
      .single();

    if (progErr) {
      console.error("Program insert failed:", progErr.message);
      return respond(res, 500, { error: "Failed to store program" });
    }

    /* ── 8. Generate text summary ── */
    const summary = formatSummary(programData, weekNo);

    /* ── 9. Send program via WhatsApp ── */
    const waResult = await sendText(client.phone, summary, { isClient: true });

    /* ── 10. Update record with send timestamp ── */
    if (waResult.ok) {
      await supabase
        .from("programs")
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq("id", programRecord.id);
    }

    console.log(
      `Program generated & sent: client ${maskPhone(client.phone)}, week ${weekNo}`
    );

    /* ── 11. Return program data ── */
    return respond(res, 200, {
      ok: true,
      program_id: programRecord.id,
      week_no: weekNo,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      coach_notes: programData.coach_notes,
    });
  } catch (err) {
    console.error("Generate program error:", err);
    return respond(res, 500, { error: "Internal server error" });
  }
};
