const Anthropic = require("@anthropic-ai/sdk");
const { supabase } = require("../lib/supabase");
const { sendWhatsApp } = require("../lib/whatsapp");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expert fitness program architect for FitnessByMaddy. Create personalized weekly workout and nutrition plans.

Rules:
- Be science-based, safe, and realistic.
- Never suggest calorie intake below 1200 kcal/day for women or 1500 kcal/day for men.
- Never recommend banned or controlled substances (steroids, SARMs, ephedrine, DNP, clenbuterol, etc.).
- Never promise unrealistic timelines (e.g., "lose 10 kg in a week").
- Account for injuries, medical conditions, and fitness level.
- Progressive overload: increase difficulty gradually week over week.
- Include warm-up and cool-down guidance.

Output Format (JSON only, no markdown):
{
  "workout_plan": [
    {
      "day": "Monday",
      "focus": "Upper Body Push",
      "exercises": [
        { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
      ],
      "warmup": "5 min light cardio + arm circles",
      "cooldown": "5 min stretching"
    }
  ],
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 60,
    "water_liters": 2.5,
    "meals": [
      { "meal": "Breakfast", "suggestion": "Oats with protein powder, banana, almond butter", "calories": 450 }
    ],
    "notes": "Any dietary notes"
  },
  "notes": "Coaching notes for the week — motivation, focus areas, adjustments from last week"
}`;

const BANNED_SUBSTANCES = [
  "steroid",
  "sarm",
  "ephedrine",
  "dnp",
  "clenbuterol",
  "dianabol",
  "trenbolone",
  "anavar",
  "testosterone enanthate",
  "testosterone cypionate",
  "hgh",
  "human growth hormone",
  "insulin",
  "t3",
  "cytomel",
];

/**
 * Validate the generated program for safety.
 * Returns { safe: true } or { safe: false, reasons: [...] }
 */
function validateSafety(program, client) {
  const reasons = [];
  const planJson = JSON.stringify(program).toLowerCase();

  // Check calorie floor
  if (program.nutrition_plan && program.nutrition_plan.daily_calories) {
    const cals = program.nutrition_plan.daily_calories;
    const gender = (client.gender || "").toLowerCase();

    if (gender === "female" && cals < 1200) {
      reasons.push(`Calorie intake ${cals} is below the 1200 kcal floor for women`);
    }
    if (gender === "male" && cals < 1500) {
      reasons.push(`Calorie intake ${cals} is below the 1500 kcal floor for men`);
    }
    // If gender unknown, use the lower floor
    if (!gender && cals < 1200) {
      reasons.push(`Calorie intake ${cals} is below the 1200 kcal safety floor`);
    }
  }

  // Check for banned substances
  for (const substance of BANNED_SUBSTANCES) {
    if (planJson.includes(substance)) {
      reasons.push(`Contains reference to banned substance: ${substance}`);
    }
  }

  return reasons.length === 0
    ? { safe: true }
    : { safe: false, reasons };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { client_id, week_no: requestedWeekNo } = req.body || {};

    if (!client_id) {
      return res.status(400).json({ error: "client_id is required" });
    }

    // ── Load client profile ──────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // ── Calculate week number ────────────────────────────────────
    let weekNo = requestedWeekNo;
    if (!weekNo) {
      const now = new Date();
      const startDate = new Date(client.program_started_at);
      const diffMs = now.getTime() - startDate.getTime();
      weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
      if (weekNo < 1) weekNo = 1;
    }

    // ── Load last 2 check-ins ────────────────────────────────────
    const { data: checkins, error: checkinsErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinsErr) {
      console.error("[generate-program] Failed to load check-ins:", checkinsErr.message);
    }

    // ── Build the user prompt ────────────────────────────────────
    const clientProfile = {
      name: client.name,
      age: client.age,
      gender: client.gender,
      height_cm: client.height_cm,
      weight_kg: client.weight_kg,
      goal: client.goal,
      fitness_level: client.fitness_level,
      injuries: client.injuries,
      dietary_restrictions: client.dietary_restrictions,
      equipment_access: client.equipment_access,
      program_type: client.program_type,
    };

    const checkinSummary = (checkins || []).map((c) => ({
      week: c.week_no,
      weight: c.weight_kg,
      compliance: c.compliance_pct,
      energy_level: c.energy_level,
      sleep_hours: c.sleep_hours,
      issues: c.issues,
      notes: c.notes,
    }));

    const userPrompt = `Create a personalized Week ${weekNo} program for this client.

CLIENT PROFILE:
${JSON.stringify(clientProfile, null, 2)}

RECENT CHECK-IN DATA (most recent first):
${checkinSummary.length > 0 ? JSON.stringify(checkinSummary, null, 2) : "No previous check-ins available (this may be the first week)."}

WEEK NUMBER: ${weekNo}

${weekNo > 1 && checkinSummary.length > 0 ? `Based on the check-in data, adjust the program accordingly:
- If compliance is low, simplify the plan
- If energy is low, reduce volume slightly
- If weight is trending in the right direction, maintain or slightly progress
- Address any reported issues or injuries` : "This is an early week — start conservatively and build a foundation."}

Respond ONLY with the JSON object, no additional text.`;

    // ── Call Claude API ───────────────────────────────────────────
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract the text content from Claude's response
    const responseText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // ── Parse JSON response ──────────────────────────────────────
    let program;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in response");
      }
      program = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("[generate-program] Failed to parse Claude response:", parseErr.message);
      return res.status(500).json({
        error: "Failed to parse program from AI response",
        raw: responseText.slice(0, 500),
      });
    }

    // ── Safety validation ────────────────────────────────────────
    const safety = validateSafety(program, client);

    if (!safety.safe) {
      console.error("[generate-program] Safety check failed:", safety.reasons);

      // Flag for manual review — store but mark as flagged
      await supabase.from("programs").insert({
        client_id,
        week_no: weekNo,
        generated_at: new Date().toISOString(),
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.notes,
        status: "flagged",
        flag_reasons: safety.reasons,
      });

      return res.status(422).json({
        error: "Program flagged for safety review",
        reasons: safety.reasons,
      });
    }

    // ── Store in programs table ──────────────────────────────────
    const { data: savedProgram, error: saveErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no: weekNo,
        generated_at: new Date().toISOString(),
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.notes,
        status: "active",
      })
      .select("id")
      .single();

    if (saveErr) {
      console.error("[generate-program] Failed to save program:", saveErr.message);
      return res.status(500).json({ error: "Failed to save program" });
    }

    const programId = savedProgram.id;
    const viewUrl = `https://fitnessbymaddy.com/api/program-pdf?id=${programId}`;

    // ── Send via WhatsApp ────────────────────────────────────────
    await sendWhatsApp(client.phone, "weekly_program", {
      name: client.name,
      templateParams: [client.name, String(weekNo), viewUrl],
    });

    console.log(
      `[generate-program] Generated and sent Week ${weekNo} program for client ${client_id}`
    );

    return res.status(200).json({
      message: "Program generated successfully",
      program_id: programId,
      week_no: weekNo,
      view_url: viewUrl,
      workout_plan: program.workout_plan,
      nutrition_plan: program.nutrition_plan,
      notes: program.notes,
    });
  } catch (err) {
    console.error("[generate-program] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
