const Anthropic = require("@anthropic-ai/sdk").default;
const { getSupabase } = require("./lib/supabase");
const { sendWhatsApp, maskPhone } = require("./lib/whatsapp");
const { logMessage } = require("./lib/messages");
const { escalateToMaddy } = require("./lib/escalation");

const SAFETY_FLAGS = [
  "extreme calorie",
  "under 1000 calories",
  "under 800 calories",
  "banned substance",
  "steroid",
  "dnp",
  "clenbuterol",
  "ephedra",
  "lose 10kg in a week",
  "crash diet",
];

function checkSafety(text) {
  const lower = (text || "").toLowerCase();
  return SAFETY_FLAGS.filter((flag) => lower.includes(flag));
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = getSupabase();
  const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res
        .status(400)
        .json({ error: "client_id and week_no required" });
    }

    const { data: client } = await db
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const { data: intake } = await db
      .from("intake_forms")
      .select("*")
      .eq("lead_id", client.lead_id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    const prompt = `You are a certified fitness program architect for FitnessByMaddy.

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Week: ${week_no} of 12
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Current weight: ${intake.current_weight}, Target: ${intake.target_weight}
- Height: ${intake.height}
- Injuries/conditions: ${intake.injuries || "None"}
- Medical: ${intake.medical_conditions || "None"}
- Diet preference: ${intake.diet_preference || "No preference"}
- Experience: ${intake.workout_experience || "Beginner"}
- Equipment: ${intake.available_equipment || "Full gym"}
- Schedule: ${intake.weekly_schedule || "5 days/week"}
- Sleep: ${intake.sleep_hours || "7"} hours` : "No intake form data"}

RECENT CHECK-INS:
${recentCheckins && recentCheckins.length > 0 ? recentCheckins.map((c) => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues=${c.issues || "None"}`).join("\n") : "No previous check-ins"}

Generate a complete Week ${week_no} program with:
1. WORKOUT PLAN: 4-6 sessions with exercises, sets, reps, rest times, RPE targets
2. NUTRITION PLAN: Daily calorie target, macros (protein/carbs/fat), 3 meal examples, hydration
3. NOTES: Key focus areas, adjustments from last week, motivation

Output as JSON with this exact structure:
{
  "workout_plan": {
    "sessions": [
      {
        "day": "Day 1 - Upper Body Push",
        "exercises": [
          {"name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "rpe": 8, "notes": "..."}
        ]
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      {"name": "Meal 1", "description": "...", "calories": 500}
    ],
    "hydration_liters": 3,
    "supplements": ["..."]
  },
  "notes": "..."
}

SAFETY RULES:
- Never recommend under 1200 calories for women or 1500 for men
- Never recommend banned substances or extreme measures
- Account for any injuries or medical conditions
- Be progressive but safe — don't increase volume more than 10%/week`;

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in Claude response");
    }

    const programData = JSON.parse(jsonMatch[0]);

    const safetyIssues = checkSafety(JSON.stringify(programData));
    if (safetyIssues.length > 0) {
      await escalateToMaddy(
        `Safety flag in generated program: ${safetyIssues.join(", ")}`,
        client.phone,
        `Week ${week_no} program for ${client.name}`
      );
      return res.json({
        ok: false,
        action: "flagged_for_review",
        issues: safetyIssues,
      });
    }

    const pdfContent = generatePDFHTML(client, week_no, programData);
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage
      .from("client-files")
      .upload(pdfPath, Buffer.from(pdfContent), {
        contentType: "text/html",
        upsert: true,
      });

    const { data: urlData } = db.storage
      .from("client-files")
      .getPublicUrl(pdfPath);

    const { error: progErr } = await db.from("programs").insert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: urlData?.publicUrl || pdfPath,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.notes,
    });

    if (progErr) {
      console.error("[PROGRAM]", progErr.message);
    }

    await sendWhatsApp(client.phone, "weekly_program", {
      name: client.name,
      templateParams: [client.name, String(week_no)],
      media: urlData?.publicUrl
        ? { url: urlData.publicUrl, filename: `Week_${week_no}_Program.html` }
        : {},
    });

    await logMessage(
      client.phone,
      "out",
      `Week ${week_no} program sent`,
      "weekly_program"
    );

    await db.from("programs")
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq("client_id", client_id)
      .eq("week_no", week_no);

    console.log(
      `[PROGRAM] Generated Week ${week_no} for ${maskPhone(client.phone)}`
    );

    return res.json({
      ok: true,
      action: "program_generated",
      week_no,
      pdf_url: urlData?.publicUrl,
    });
  } catch (err) {
    console.error("[GENERATE ERROR]", err.message);
    return res.status(500).json({ error: "Failed to generate program" });
  }
};

function generatePDFHTML(client, weekNo, data) {
  const { workout_plan, nutrition_plan, notes } = data;

  const workoutRows = (workout_plan?.sessions || [])
    .map(
      (session) => `
    <div class="session">
      <h3>${session.day}</h3>
      <table>
        <tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>RPE</th><th>Notes</th></tr>
        ${(session.exercises || [])
          .map(
            (ex) =>
              `<tr><td>${ex.name}</td><td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rest}</td><td>${ex.rpe || "-"}</td><td>${ex.notes || "-"}</td></tr>`
          )
          .join("")}
      </table>
    </div>`
    )
    .join("");

  const mealRows = (nutrition_plan?.meals || [])
    .map(
      (m) =>
        `<div class="meal"><strong>${m.name}</strong> (${m.calories || "—"} cal)<br>${m.description}</div>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Week ${weekNo} Program — ${client.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'DM Sans',sans-serif; background:#111; color:#fff; padding:40px 24px; }
.header { text-align:center; margin-bottom:48px; border-bottom:2px solid #B8965A; padding-bottom:32px; }
.header h1 { font-family:'Bebas Neue',sans-serif; font-size:48px; color:#B8965A; letter-spacing:4px; }
.header h2 { font-family:'Bebas Neue',sans-serif; font-size:28px; color:#fff; letter-spacing:2px; margin-top:8px; }
.header p { color:#888; font-size:14px; margin-top:8px; }
h3 { font-family:'Bebas Neue',sans-serif; font-size:22px; color:#B8965A; letter-spacing:2px; margin:24px 0 12px; }
table { width:100%; border-collapse:collapse; margin-bottom:24px; }
th { background:#222; color:#B8965A; text-align:left; padding:10px 12px; font-size:12px; text-transform:uppercase; letter-spacing:1px; }
td { padding:10px 12px; border-bottom:1px solid #333; font-size:14px; color:#ddd; }
.session { margin-bottom:32px; }
.section-title { font-family:'Bebas Neue',sans-serif; font-size:32px; color:#B8965A; letter-spacing:3px; margin:40px 0 20px; border-bottom:1px solid #333; padding-bottom:12px; }
.macros { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:20px 0; }
.macro-box { background:#1a1a1a; border:1px solid #333; border-radius:8px; padding:16px; text-align:center; }
.macro-box .val { font-family:'Bebas Neue',sans-serif; font-size:32px; color:#B8965A; }
.macro-box .label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-top:4px; }
.meal { background:#1a1a1a; border-left:3px solid #B8965A; padding:16px; margin-bottom:12px; border-radius:0 8px 8px 0; }
.notes { background:#1a1a1a; border:1px solid #333; border-radius:8px; padding:24px; margin-top:20px; line-height:1.7; color:#ccc; }
.footer { text-align:center; margin-top:48px; padding-top:24px; border-top:1px solid #333; color:#666; font-size:12px; }
</style>
</head>
<body>
<div class="header">
  <h1>FITNESS BY MADDY</h1>
  <h2>WEEK ${weekNo} PROGRAM</h2>
  <p>${client.name} | ${client.program.toUpperCase()}</p>
</div>

<div class="section-title">WORKOUT PLAN</div>
${workoutRows}

<div class="section-title">NUTRITION PLAN</div>
<div class="macros">
  <div class="macro-box"><div class="val">${nutrition_plan?.daily_calories || "—"}</div><div class="label">Calories</div></div>
  <div class="macro-box"><div class="val">${nutrition_plan?.protein_g || "—"}g</div><div class="label">Protein</div></div>
  <div class="macro-box"><div class="val">${nutrition_plan?.carbs_g || "—"}g</div><div class="label">Carbs</div></div>
  <div class="macro-box"><div class="val">${nutrition_plan?.fat_g || "—"}g</div><div class="label">Fat</div></div>
</div>
${mealRows}

${notes ? `<div class="section-title">COACH NOTES</div><div class="notes">${notes}</div>` : ""}

<div class="footer">
  FITNESS BY MADDY &copy; ${new Date().getFullYear()} | Generated ${new Date().toLocaleDateString()}<br>
  This program is personalised — do not share or redistribute.
</div>
</body>
</html>`;
}
