const { getSupabase } = require("./lib/supabase");
const { sendText, maskPhone } = require("./lib/whatsapp");
const { notifyMaddy } = require("./lib/whatsapp");
const Anthropic = require("@anthropic-ai/sdk");

const SAFETY_FLAGS = [
  "below 1200 calories",
  "below 1000 calories",
  "under 1200",
  "under 1000",
  "clenbuterol",
  "dnp",
  "ephedra",
  "steroid",
  "anabolic",
  "sarm",
  "10 lbs in a week",
  "20 lbs in a month",
];

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const db = getSupabase();
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: "Missing client_id or week_no" });
    }

    const { data: client } = await db
      .from("clients")
      .select("*, leads(intake_data, market)")
      .eq("id", client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const { data: recentCheckins } = await db
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    const { data: prevPrograms } = await db
      .from("programs")
      .select("week_no, workout_plan, nutrition_plan, notes")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(1);

    const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, recentCheckins, prevPrograms, week_no);

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const content = response.content[0].text;

    const hasSafetyIssue = SAFETY_FLAGS.some((flag) =>
      content.toLowerCase().includes(flag)
    );

    if (hasSafetyIssue) {
      await notifyMaddy(
        "Program Safety Flag",
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no} program flagged for review — may contain risky recommendations.`
      );
      return res.status(200).json({
        success: false,
        reason: "safety_flagged",
        client_id,
        week_no,
      });
    }

    let parsed;
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : content);
    } catch {
      parsed = { raw_text: content, workout_plan: null, nutrition_plan: null };
    }

    const { data: program } = await db
      .from("programs")
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        workout_plan: parsed.workout_plan || parsed,
        nutrition_plan: parsed.nutrition_plan || null,
        notes: parsed.coach_notes || null,
      })
      .select()
      .single();

    const summary =
      parsed.coach_notes ||
      `Week ${week_no} program ready! Check your plan and let us know if you have questions 💪`;

    await sendText(client.phone, summary);

    await db
      .from("programs")
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq("id", program.id);

    return res.status(200).json({
      success: true,
      program_id: program.id,
      week_no,
    });
  } catch (err) {
    console.error("Program generation error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function buildSystemPrompt() {
  return `You are a certified fitness coach and program architect for FitnessByMaddy, a premium women's fitness coaching brand.

Your job is to create personalized weekly workout and nutrition plans based on client data and check-in history.

Rules:
- Programs must be safe, evidence-based, and appropriate for the client's level
- Never recommend fewer than 1400 calories/day for women
- Never recommend banned substances, steroids, SARMs, or dangerous supplements
- Never promise unrealistic timelines (e.g., "lose 20 lbs in 2 weeks")
- Consider injuries, medical conditions, and limitations
- Progressive overload: increase volume/intensity gradually week over week
- Nutrition should be flexible and sustainable, not extreme
- Tone: warm, expert, encouraging — never bro-sciency

Output format: Valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-10", "rest": "90s", "notes": "..." }
      ]},
      ...
    ],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 130,
    "carbs_g": 200,
    "fat_g": 60,
    "meal_timing": "...",
    "sample_day": [ ... ],
    "notes": "..."
  },
  "coach_notes": "One-liner summary/motivation for WhatsApp message"
}`;
}

function buildUserPrompt(client, checkins, prevPrograms, weekNo) {
  const intake = client.leads?.intake_data || {};
  const prev = prevPrograms?.[0] || null;
  const lastCheckin = checkins?.[0] || null;
  const prevCheckin = checkins?.[1] || null;

  return `Create Week ${weekNo} program for this client:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Age: ${intake.age || "Unknown"}
- Gender: ${intake.gender || "Female"}
- Height: ${intake.height || "Unknown"}
- Starting Weight: ${intake.weight || "Unknown"}
- Goal: ${intake.goal || "General fitness"}
- Injuries/Limitations: ${intake.injuries || "None reported"}
- Diet Preference: ${intake.diet_preference || "No preference"}
- Experience: ${intake.experience_level || "Beginner"}
- Schedule: ${intake.schedule || "5 days/week"}
- Medical: ${intake.medical_conditions || "None"}
- Sleep: ${intake.sleep_hours || "Unknown"} hrs/night
- Stress: ${intake.stress_level || "Unknown"}

${lastCheckin ? `LATEST CHECK-IN (Week ${lastCheckin.week_no}):
- Weight: ${lastCheckin.weight || "N/A"}
- Waist: ${lastCheckin.waist || "N/A"}
- Compliance: ${lastCheckin.compliance_score}/10
- Energy: ${lastCheckin.energy}/10
- Issues: ${lastCheckin.issues || "None"}` : "No check-in data yet."}

${prevCheckin ? `PREVIOUS CHECK-IN (Week ${prevCheckin.week_no}):
- Weight: ${prevCheckin.weight || "N/A"}
- Compliance: ${prevCheckin.compliance_score}/10
- Energy: ${prevCheckin.energy}/10` : ""}

${prev ? `PREVIOUS WEEK PROGRAM SUMMARY:
- Week ${prev.week_no}
- Notes: ${prev.notes || "None"}` : "No previous program — this is Week 1."}

Generate the Week ${weekNo} program as JSON.`;
}
