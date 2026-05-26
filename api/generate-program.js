const Anthropic = require("@anthropic-ai/sdk");
const { supabase } = require("./_lib/supabase");
const { sendText } = require("./_lib/whatsapp");
const { notifyMaddy } = require("./_lib/escalation");

const anthropic = new Anthropic();

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

const SYSTEM_PROMPT = `You are a program_architect — an expert fitness and nutrition coach assistant for Fitness by Maddy.

Your job is to generate a personalized weekly workout and nutrition plan as structured JSON.

Consider the following when generating the plan:
- The client's program type, goals, body stats, and preferences
- Their previous compliance scores and energy levels from recent check-ins
- Any issues or concerns they have reported
- Apply progressive overload principles: gradually increase volume, intensity, or complexity week over week
- Ensure nutrition supports the training demands and client goals
- Be conservative with calorie deficits — never below 1200 kcal for women or 1500 kcal for men
- Never recommend banned substances, extreme diets, or unrealistic timelines

You MUST respond with valid JSON only, no markdown fences, no commentary outside the JSON. Use this exact structure:

{
  "workout_plan": {
    "week_no": <number>,
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "exercises": [
          {
            "name": "Bench Press",
            "sets": 4,
            "reps": "8-10",
            "rest_seconds": 90,
            "notes": "Increase weight by 2.5kg from last week if all reps completed"
          }
        ],
        "cardio": { "type": "Incline Walk", "duration_minutes": 20 },
        "notes": ""
      }
    ],
    "deload": false,
    "notes": ""
  },
  "nutrition_plan": {
    "daily_calories": <number>,
    "protein_g": <number>,
    "carbs_g": <number>,
    "fat_g": <number>,
    "meals": [
      {
        "meal": "Breakfast",
        "description": "Oats with whey protein, banana, and almonds",
        "approx_calories": 450
      }
    ],
    "hydration_liters": 3,
    "supplements": ["Whey protein", "Creatine 5g"],
    "notes": ""
  }
}`;

function formatPlanAsText(plan, client, weekNo) {
  const lines = [];
  lines.push("===========================================");
  lines.push("   FITNESS BY MADDY - WEEKLY PROGRAM");
  lines.push("===========================================");
  lines.push("");
  lines.push(`Client: ${client.name || "Client"}`);
  lines.push(`Week: ${weekNo}`);
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Workout plan
  const wp = plan.workout_plan;
  if (wp) {
    lines.push("-------------------------------------------");
    lines.push("  WORKOUT PLAN");
    lines.push("-------------------------------------------");
    if (wp.deload) lines.push("  ** DELOAD WEEK **");
    if (wp.notes) lines.push(`  Note: ${wp.notes}`);
    lines.push("");

    if (Array.isArray(wp.days)) {
      for (const day of wp.days) {
        lines.push(`  ${day.day} — ${day.focus}`);
        lines.push("  " + "-".repeat(30));

        if (Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            lines.push(
              `    ${ex.name}: ${ex.sets} x ${ex.reps} (rest ${ex.rest_seconds}s)`
            );
            if (ex.notes) lines.push(`      -> ${ex.notes}`);
          }
        }

        if (day.cardio) {
          lines.push(
            `    Cardio: ${day.cardio.type} — ${day.cardio.duration_minutes} min`
          );
        }

        if (day.notes) lines.push(`    Note: ${day.notes}`);
        lines.push("");
      }
    }
  }

  // Nutrition plan
  const np = plan.nutrition_plan;
  if (np) {
    lines.push("-------------------------------------------");
    lines.push("  NUTRITION PLAN");
    lines.push("-------------------------------------------");
    lines.push(`  Daily Calories: ${np.daily_calories} kcal`);
    lines.push(
      `  Macros: P ${np.protein_g}g | C ${np.carbs_g}g | F ${np.fat_g}g`
    );
    lines.push(`  Hydration: ${np.hydration_liters}L / day`);
    lines.push("");

    if (Array.isArray(np.meals)) {
      for (const meal of np.meals) {
        lines.push(`    ${meal.meal} (~${meal.approx_calories} kcal)`);
        lines.push(`      ${meal.description}`);
      }
    }

    if (Array.isArray(np.supplements) && np.supplements.length > 0) {
      lines.push("");
      lines.push(`  Supplements: ${np.supplements.join(", ")}`);
    }

    if (np.notes) {
      lines.push("");
      lines.push(`  Note: ${np.notes}`);
    }
  }

  lines.push("");
  lines.push("===========================================");
  lines.push("  Questions? Message Maddy on WhatsApp!");
  lines.push("===========================================");

  return lines.join("\n");
}

function runSafetyCheck(plan, client) {
  const issues = [];

  const np = plan.nutrition_plan;
  if (np && np.daily_calories) {
    const gender = (client.gender || "").toLowerCase();
    if (gender === "female" && np.daily_calories < 1200) {
      issues.push(
        `Extreme calorie cut for female client: ${np.daily_calories} kcal (min 1200)`
      );
    }
    if (gender === "male" && np.daily_calories < 1500) {
      issues.push(
        `Extreme calorie cut for male client: ${np.daily_calories} kcal (min 1500)`
      );
    }
  }

  // Check for banned substances
  const banned = [
    "clenbuterol",
    "dnp",
    "ephedra",
    "anabolic steroid",
    "sarm",
    "hgh",
    "testosterone",
    "trenbolone",
    "dianabol",
    "winstrol",
    "anadrol",
  ];
  const planText = JSON.stringify(plan).toLowerCase();
  for (const substance of banned) {
    if (planText.includes(substance)) {
      issues.push(`Banned substance mentioned: ${substance}`);
    }
  }

  // Check for unrealistic timelines
  const unrealistic = [
    "lose 10kg in 1 week",
    "lose 20 pounds in a week",
    "lose 5kg in 3 days",
    "rapid weight loss",
    "crash diet",
  ];
  for (const phrase of unrealistic) {
    if (planText.includes(phrase)) {
      issues.push(`Unrealistic timeline detected: "${phrase}"`);
    }
  }

  return issues;
}

module.exports = async function handler(req, res) {
  corsHeaders(res);

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

    // --- load client profile ---
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // --- load last 2 check-ins ---
    const { data: checkins, error: checkinErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error("Error loading check-ins:", checkinErr.message);
    }

    // --- determine week_no ---
    let weekNo = requestedWeekNo;
    if (!weekNo && checkins && checkins.length > 0) {
      weekNo = checkins[0].week_no;
    }
    if (!weekNo) {
      weekNo = 1;
    }

    // --- build Claude prompt ---
    const userPrompt = JSON.stringify(
      {
        client_profile: {
          name: client.name,
          gender: client.gender,
          age: client.age,
          height_cm: client.height_cm,
          weight_kg: client.weight_kg,
          program_type: client.program_type,
          goals: client.goals,
          dietary_preferences: client.dietary_preferences,
          injuries_limitations: client.injuries_limitations,
          experience_level: client.experience_level,
          equipment_access: client.equipment_access,
        },
        current_week: weekNo,
        recent_checkins: (checkins || []).map((c) => ({
          week_no: c.week_no,
          weight: c.weight,
          waist: c.waist,
          compliance_score: c.compliance_score,
          energy: c.energy,
          issues: c.issues,
        })),
      },
      null,
      2
    );

    // --- call Claude API ---
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate the Week ${weekNo} program for this client:\n\n${userPrompt}`,
        },
      ],
    });

    const responseText =
      message.content && message.content[0] && message.content[0].text
        ? message.content[0].text
        : "";

    let plan;
    try {
      // strip markdown fences if present
      const cleaned = responseText
        .replace(/^```json\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
      plan = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse Claude response as JSON:", parseErr.message);
      console.error("Raw response:", responseText.substring(0, 500));
      return res.status(500).json({ error: "Failed to parse generated program" });
    }

    // --- safety check ---
    const safetyIssues = runSafetyCheck(plan, client);
    if (safetyIssues.length > 0) {
      console.warn("Safety issues detected:", safetyIssues);

      try {
        await notifyMaddy("Program safety flag", {
          clientPhone: client.phone,
          messageBody: `Week ${weekNo} program flagged:\n${safetyIssues.join("\n")}`,
        });
      } catch (notifyErr) {
        console.error("Failed to notify Maddy:", notifyErr.message);
      }

      // Store flagged program but don't send to client
      await supabase.from("programs").insert({
        client_id,
        week_no: weekNo,
        workout_plan: plan.workout_plan || null,
        nutrition_plan: plan.nutrition_plan || null,
        status: "flagged",
        safety_issues: safetyIssues,
        created_at: new Date().toISOString(),
      });

      return res.status(200).json({
        success: false,
        flagged: true,
        safety_issues: safetyIssues,
        message: "Program flagged for Maddy review due to safety concerns",
      });
    }

    // --- store program ---
    const { data: program, error: programErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no: weekNo,
        workout_plan: plan.workout_plan || null,
        nutrition_plan: plan.nutrition_plan || null,
        status: "sent",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (programErr) {
      console.error("Program insert error:", programErr.message);
      return res.status(500).json({ error: "Failed to save program" });
    }

    // --- generate formatted text and upload ---
    const formattedText = formatPlanAsText(plan, client, weekNo);
    const storagePath = `clients/${client_id}/week_${weekNo}.txt`;

    try {
      const textBuffer = Buffer.from(formattedText, "utf-8");
      await supabase.storage
        .from("programs")
        .upload(storagePath, textBuffer, {
          contentType: "text/plain",
          upsert: true,
        });
    } catch (uploadErr) {
      console.error("Program upload error:", uploadErr.message);
      // non-blocking
    }

    // --- send via WhatsApp ---
    try {
      const np = plan.nutrition_plan || {};
      const wp = plan.workout_plan || {};
      const dayCount = Array.isArray(wp.days) ? wp.days.length : 0;

      const summary =
        `Your Week ${weekNo} program is ready!\n\n` +
        `Workout: ${dayCount} training days${wp.deload ? " (deload week)" : ""}\n` +
        `Nutrition: ${np.daily_calories || "—"} kcal | P${np.protein_g || "—"}g C${np.carbs_g || "—"}g F${np.fat_g || "—"}g\n\n` +
        `Full plan has been saved to your account. Let me know if you have any questions!`;

      await sendText(client.phone, summary);
    } catch (whatsappErr) {
      console.error("WhatsApp send failed:", whatsappErr.message);
      // non-blocking — program is saved
    }

    return res.status(200).json({ success: true, program_id: program.id });
  } catch (err) {
    console.error("generate-program error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
