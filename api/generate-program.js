const { supabase } = require("./lib/supabase");
const { maskPhone } = require("./lib/utils");

/**
 * POST /api/generate-program
 * Generates a personalised weekly training + nutrition plan via Claude,
 * validates it for safety, and saves to the programs table.
 */

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a certified fitness program architect for FitnessByMaddy. Create a weekly training and nutrition plan. Be specific with exercises, sets, reps, rest periods. Nutrition should include specific calorie targets, macro splits, and meal suggestions. NEVER recommend extreme calorie cuts below 1200cal, banned substances, or unrealistic timelines. If the client reports pain or medical issues, recommend consulting a doctor.`;

const UNSAFE_PATTERNS = [
  /\b(below|under)\s*1[01]\d{2}\s*(cal|kcal|calories)/i,
  /\b([2-9]\d{2}|1[01]\d{2})\s*(cal|kcal|calories)\s*(per\s*day|daily|\/\s*day)/i,
  /\bclenbuterol\b/i,
  /\bdnp\b/i,
  /\bdinitrophenol\b/i,
  /\bephedra\b/i,
  /\banabolic\s*steroid/i,
  /\bsarm/i,
  /\bhgh\b/i,
  /\bhuman\s*growth\s*hormone\b/i,
  /\btrenbolone\b/i,
  /\bstanozolol\b/i,
];

function checkSafety(text) {
  for (const pattern of UNSAFE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { safe: false, reason: `Unsafe content detected: "${match[0]}"` };
    }
  }
  return { safe: true, reason: "" };
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res
        .status(400)
        .json({ error: "client_id and week_no are required" });
    }

    // 1. Fetch client profile
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      console.error(
        `Client not found: ${client_id}`,
        clientErr?.message
      );
      return res.status(404).json({ error: "Client not found" });
    }

    // 2. Fetch last 2 check-ins for context
    const { data: checkins, error: checkinErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error(
        `Failed to fetch check-ins for ${maskPhone(client.phone)}:`,
        checkinErr.message
      );
      // Non-fatal — proceed with no check-in context
    }

    // 3. Build user message for Claude
    const checkinSummary =
      checkins && checkins.length > 0
        ? checkins
            .map(
              (ci) =>
                `Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, compliance=${ci.compliance_score}/10, energy=${ci.energy}/10, issues="${ci.issues || "none"}"`
            )
            .join("\n")
        : "No previous check-in data available.";

    const userMessage = `Client profile:
- Program: ${client.program}
- Current week: ${week_no}
- Name: ${client.name || "N/A"}

Recent check-in data:
${checkinSummary}

Generate the week ${week_no} plan. Respond ONLY with valid JSON in this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
        ]
      }
    ],
    "cardio": "...",
    "rest_days": "..."
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "macros": { "protein_g": 140, "carbs_g": 180, "fat_g": 60 },
    "meals": [
      { "meal": "Breakfast", "suggestion": "...", "calories": 400 }
    ],
    "hydration": "...",
    "supplements": "..."
  },
  "notes": "..."
}`;

    // 4. Call Claude API
    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error(
        `Claude API error for ${maskPhone(client.phone)}:`,
        claudeRes.status,
        errBody
      );
      return res
        .status(502)
        .json({ error: "Failed to generate program from AI" });
    }

    const claudeData = await claudeRes.json();

    // Extract text content from Claude response
    const rawText =
      claudeData.content &&
      claudeData.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

    if (!rawText) {
      console.error(
        `Empty Claude response for ${maskPhone(client.phone)}`
      );
      return res.status(502).json({ error: "Empty AI response" });
    }

    // 5. Parse the JSON from Claude's response
    let program;
    try {
      // Claude may wrap JSON in markdown code fences
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      program = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error(
        `Failed to parse Claude JSON for ${maskPhone(client.phone)}:`,
        parseErr.message
      );
      return res
        .status(502)
        .json({ error: "Failed to parse AI response as JSON" });
    }

    // 6. Safety check
    const fullText = JSON.stringify(program);
    const safety = checkSafety(fullText);

    if (!safety.safe) {
      console.error(
        `Safety check failed for ${maskPhone(client.phone)}: ${safety.reason}`
      );
      return res.status(400).json({
        error: "Program failed safety review",
        escalation: true,
        reason: safety.reason,
      });
    }

    // 7. Save to programs table
    const { data: saved, error: saveErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no,
        workout_plan: program.workout_plan,
        nutrition_plan: program.nutrition_plan,
        notes: program.notes || "",
        generated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (saveErr) {
      console.error(
        `Failed to save program for ${maskPhone(client.phone)}:`,
        saveErr.message
      );
      return res.status(500).json({ error: "Failed to save program" });
    }

    console.log(
      `Generated week-${week_no} program for ${maskPhone(client.phone)} (${client.program}).`
    );

    // 8. Return the program data
    return res.status(200).json({
      program_id: saved.id,
      client_id,
      week_no,
      workout_plan: saved.workout_plan,
      nutrition_plan: saved.nutrition_plan,
      notes: saved.notes,
    });
  } catch (err) {
    console.error("generate-program error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = handler;
