const Anthropic = require("@anthropic-ai/sdk");
const PDFDocument = require("pdfkit");
const { getSupabase } = require("../lib/supabase");
const { sendWhatsAppForced, maskPhone } = require("../lib/whatsapp");
const { detectMarket, isHinglish } = require("../lib/market");

const RISKY_PATTERNS = [
  /below\s*1[0-2]00\s*cal/i,
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm|steroid/i,
  /lose\s*\d{2,}\s*kg\s*in\s*(one|1|two|2)\s*week/i,
];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: "Missing client_id or week_no" });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from("clients")
      .select("*, leads!clients_lead_id_fkey(intake_data, market)")
      .eq("id", client_id)
      .single();

    if (!client) return res.status(404).json({ error: "Client not found" });

    const { data: recentCheckins } = await db
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    const intake = client.leads?.intake_data || {};
    const checkinSummary = (recentCheckins || []).map((c) => ({
      week: c.week_no,
      weight: c.weight,
      waist: c.waist,
      compliance: c.compliance_score,
      energy: c.energy,
      issues: c.issues,
    }));

    const anthropic = new Anthropic();
    const prompt = buildPrompt(client, intake, checkinSummary, week_no);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      system:
        "You are a certified fitness program architect. Create detailed, safe, evidence-based workout and nutrition plans. Output valid JSON only. Never recommend extreme calorie restriction below 1200 cal, banned substances, or unrealistic timelines.",
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: "Failed to parse program JSON" });
    }

    const fullText = JSON.stringify(programData);
    for (const pattern of RISKY_PATTERNS) {
      if (pattern.test(fullText)) {
        const { escalateToMaddy } = require("../lib/escalation");
        await escalateToMaddy(
          "risky_program_content",
          client.phone,
          `Week ${week_no} program flagged: ${pattern.toString()}`
        );
        return res.status(200).json({
          ok: false,
          reason: "flagged_for_review",
          pattern: pattern.toString(),
        });
      }
    }

    const pdfBuffer = await generatePDF(programData, client, week_no);

    const filePath = `clients/${client_id}/week_${week_no}.pdf`;
    await db.storage
      .from("client-files")
      .upload(filePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    const { data: urlData } = db.storage
      .from("client-files")
      .getPublicUrl(filePath);
    const pdfUrl = urlData.publicUrl;

    const { data: program } = await db
      .from("programs")
      .insert({
        client_id,
        week_no,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: programData.workout || programData.workout_plan || {},
        nutrition_plan: programData.nutrition || programData.nutrition_plan || {},
        notes: programData.notes || null,
      })
      .select()
      .single();

    const market = client.leads?.market || detectMarket(client.phone);
    const template = isHinglish(market)
      ? "weekly_program_hi"
      : "weekly_program";
    const contextNote =
      programData.context_note ||
      `Week ${week_no} program ready. ${programData.notes || "Let's crush it!"}`;

    await sendWhatsAppForced(
      client.phone,
      template,
      [client.name || "there", String(week_no), contextNote],
      pdfUrl
    );

    await db
      .from("programs")
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq("id", program.id);

    return res.status(200).json({ ok: true, programId: program.id, pdfUrl });
  } catch (err) {
    console.error("Program generation error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function buildPrompt(client, intake, checkins, weekNo) {
  return `Generate a detailed Week ${weekNo} fitness program for this client.

CLIENT PROFILE:
- Name: ${client.name || "Client"}
- Program: ${client.program}
- Age: ${intake.age || "Unknown"}
- Gender: ${intake.gender || "Unknown"}
- Goal: ${intake.goal || "General fitness"}
- Experience: ${intake.experience_level || "Intermediate"}
- Injuries/Conditions: ${intake.injuries || "None reported"}
- Diet Preference: ${intake.diet_preference || "No restrictions"}
- Current Weight: ${intake.current_weight || "Unknown"}kg
- Target Weight: ${intake.target_weight || "Not specified"}kg
- Schedule: ${intake.schedule || "5 days/week"}

RECENT CHECK-INS:
${checkins.length > 0 ? JSON.stringify(checkins, null, 2) : "No previous check-ins (Week 1)"}

OUTPUT FORMAT (JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "warmup": "...",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..." }
        ],
        "cooldown": "..."
      }
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "frequency": "...", "duration": "..." }
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein_g": 160,
    "carbs_g": 250,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."] }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "notes": "Brief coach's note for this week",
  "context_note": "One-liner WhatsApp message about this week's focus"
}`;
}

async function generatePDF(programData, client, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .rect(0, 0, doc.page.width, 120)
      .fill("#2C2C2C");

    doc
      .font("Helvetica-Bold")
      .fontSize(28)
      .fillColor("#B8965A")
      .text("FITNESS BY MADDY", 50, 35, { align: "center" });

    doc
      .fontSize(14)
      .fillColor("#FFFFFF")
      .text(`Week ${weekNo} Program`, 50, 72, { align: "center" });

    doc
      .fontSize(10)
      .fillColor("#D4AF7A")
      .text(`${client.name || "Client"} | ${client.program}`, 50, 92, { align: "center" });

    doc.moveDown(3);
    doc.fillColor("#2C2C2C");

    const workout = programData.workout_plan || programData.workout || {};
    if (workout.days) {
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#B8965A")
        .text("WORKOUT PLAN");
      doc.moveDown(0.5);

      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor("#E8E3DC")
        .stroke();
      doc.moveDown(0.5);

      for (const day of workout.days) {
        doc
          .font("Helvetica-Bold")
          .fontSize(13)
          .fillColor("#2C2C2C")
          .text(`${day.day} — ${day.focus || ""}`);
        doc.moveDown(0.3);

        if (day.warmup) {
          doc
            .font("Helvetica")
            .fontSize(9)
            .fillColor("#6B6B6B")
            .text(`Warm-up: ${day.warmup}`);
        }

        if (day.exercises) {
          for (const ex of day.exercises) {
            doc
              .font("Helvetica")
              .fontSize(10)
              .fillColor("#2C2C2C")
              .text(
                `  ${ex.name}  —  ${ex.sets} x ${ex.reps}  |  Rest: ${ex.rest || "60s"}`,
                { indent: 15 }
              );
            if (ex.notes) {
              doc
                .fontSize(8)
                .fillColor("#6B6B6B")
                .text(`    ${ex.notes}`, { indent: 25 });
            }
          }
        }

        if (day.cooldown) {
          doc
            .font("Helvetica")
            .fontSize(9)
            .fillColor("#6B6B6B")
            .text(`Cool-down: ${day.cooldown}`);
        }

        doc.moveDown(0.6);
      }
    }

    const nutrition = programData.nutrition_plan || programData.nutrition || {};
    if (nutrition.calories) {
      if (doc.y > 650) doc.addPage();

      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#B8965A")
        .text("NUTRITION PLAN");
      doc.moveDown(0.5);

      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .strokeColor("#E8E3DC")
        .stroke();
      doc.moveDown(0.5);

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#2C2C2C")
        .text("Daily Targets");
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(
          `Calories: ${nutrition.calories} kcal  |  Protein: ${nutrition.protein_g}g  |  Carbs: ${nutrition.carbs_g}g  |  Fat: ${nutrition.fat_g}g`
        );
      doc.moveDown(0.5);

      if (nutrition.meals) {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .text("Meal Plan");
        for (const meal of nutrition.meals) {
          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor("#2C2C2C")
            .text(meal.meal);
          const options = Array.isArray(meal.options) ? meal.options : [meal.options];
          for (const opt of options) {
            doc
              .font("Helvetica")
              .fontSize(9)
              .fillColor("#6B6B6B")
              .text(`  • ${opt}`, { indent: 10 });
          }
          doc.moveDown(0.3);
        }
      }

      if (nutrition.hydration) {
        doc.moveDown(0.3);
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#6B6B6B")
          .text(`Hydration: ${nutrition.hydration}`);
      }
    }

    if (programData.notes) {
      doc.moveDown(1);
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#B8965A")
        .text("COACH'S NOTES");
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#2C2C2C")
        .text(programData.notes);
    }

    const bottomY = doc.page.height - 40;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#C8B89A")
      .text(
        "Fitness by Maddy | fitnessbymaddy.com | This program is personalised — do not share.",
        50,
        bottomY,
        { align: "center" }
      );

    doc.end();
  });
}
