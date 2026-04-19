const Anthropic = require("@anthropic-ai/sdk");
const PDFDocument = require("pdfkit");
const { getSupabase } = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { maskPhone, PROGRAM_NAMES } = require("../lib/utils");
const { escalateToMaddy } = require("../lib/escalation");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: "client_id and week_no required" });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: "Client not found" });

    const { data: recentCheckins } = await db
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    const { data: leadData } = await db
      .from("leads")
      .select("*")
      .eq("id", client.lead_id)
      .maybeSingle();

    const anthropic = new Anthropic();
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, leadData, recentCheckins, week_no);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawOutput = response.content[0].text;

    let programData;
    try {
      const jsonMatch = rawOutput.match(/```json\n?([\s\S]*?)\n?```/) ||
                        rawOutput.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawOutput);
    } catch (parseErr) {
      console.error("Failed to parse Claude response:", parseErr.message);
      await escalateToMaddy("Program generation parse failure", {
        client_id,
        week_no,
        error: parseErr.message,
      });
      return res.status(500).json({ error: "Failed to parse program" });
    }

    if (hasSafetyIssues(programData)) {
      await escalateToMaddy("Program flagged for safety review", {
        client_id,
        week_no,
        reason: "Extreme calorie cuts, banned substances, or unrealistic timelines detected",
      });
      return res.status(200).json({
        action: "flagged_for_review",
        client_id,
        week_no,
      });
    }

    const pdfBuffer = await generatePDF(client, programData, week_no);

    const pdfPath = `${client_id}/week_${week_no}.pdf`;
    await db.storage
      .from("clients")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    const { data: urlData } = db.storage.from("clients").getPublicUrl(pdfPath);
    const pdfUrl = urlData.publicUrl;

    const { data: program } = await db
      .from("programs")
      .insert({
        client_id,
        week_no,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.notes || null,
      })
      .select()
      .single();

    await sendTemplate(client.phone, "weekly_program", [
      client.name || "there",
      `Week ${week_no}`,
    ], pdfUrl);

    await db.from("programs").update({
      whatsapp_sent_at: new Date().toISOString(),
    }).eq("id", program.id);

    console.log(`Program sent: ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ success: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error("generate-program error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function buildSystemPrompt() {
  return `You are the program architect for Fitness by Maddy, an elite online coaching brand.

Your job: create a detailed, personalized weekly workout + nutrition plan based on the client's profile and recent check-in data.

Rules:
- Evidence-based only. No bro-science. No extreme protocols.
- Minimum 1200 kcal/day for women, 1500 kcal/day for men. Never lower.
- No banned substances. No fat burners. No extreme supplement stacks.
- Progressive overload principles. Adjust based on compliance and energy.
- If the client reports pain or injury, reduce load and suggest medical consultation.
- Realistic timelines: max 0.5-1% bodyweight loss per week.

Output format: valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 3, "reps": "8-12", "rest": "90s", "notes": "..." }
        ]
      }
    ],
    "cardio": "...",
    "rest_days": ["Sunday"]
  },
  "nutrition_plan": {
    "calories": 1800,
    "protein_g": 140,
    "carbs_g": 200,
    "fat_g": 60,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "notes": "One-liner coaching note for WhatsApp delivery"
}`;
}

function buildUserPrompt(client, lead, checkins, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || "Client"}\n`;
  prompt += `Program: ${PROGRAM_NAMES[client.program] || client.program}\n`;
  prompt += `Week: ${weekNo}\n`;

  if (lead?.intake_data) {
    const intake = typeof lead.intake_data === "string"
      ? JSON.parse(lead.intake_data)
      : lead.intake_data;
    prompt += `\nIntake Data:\n`;
    for (const [key, val] of Object.entries(intake)) {
      if (val) prompt += `- ${key}: ${val}\n`;
    }
  }

  if (checkins && checkins.length > 0) {
    prompt += `\nRecent Check-ins:\n`;
    for (const ci of checkins) {
      prompt += `Week ${ci.week_no}: weight=${ci.weight}kg, waist=${ci.waist}cm, `;
      prompt += `compliance=${ci.compliance_score}/10, energy=${ci.energy}/10`;
      if (ci.issues) prompt += `, issues: ${ci.issues}`;
      if (ci.next_week_focus) prompt += `, focus: ${ci.next_week_focus}`;
      prompt += `\n`;
    }
  }

  return prompt;
}

function hasSafetyIssues(programData) {
  if (!programData?.nutrition_plan) return false;
  const cals = programData.nutrition_plan.calories;
  if (cals && cals < 1200) return true;

  const supps = programData.nutrition_plan.supplements || [];
  const banned = ["ephedra", "dnp", "clenbuterol", "sarms", "steroids", "hgh"];
  for (const s of supps) {
    if (banned.some((b) => s.toLowerCase().includes(b))) return true;
  }
  return false;
}

async function generatePDF(client, programData, weekNo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const CHARCOAL = "#2C2C2C";
    const GOLD = "#B8965A";

    doc.rect(0, 0, doc.page.width, 120).fill(CHARCOAL);
    doc.fontSize(28).fill("#FFFFFF").font("Helvetica-Bold")
      .text("FITNESS BY MADDY", 50, 35);
    doc.fontSize(14).fill(GOLD)
      .text(`WEEK ${weekNo} PROGRAM`, 50, 72);
    doc.fontSize(10).fill("#CCCCCC")
      .text(`${client.name || "Client"} | ${PROGRAM_NAMES[client.program] || client.program}`, 50, 95);

    let y = 140;

    if (programData.workout_plan?.days) {
      doc.fontSize(18).fill(CHARCOAL).font("Helvetica-Bold")
        .text("WORKOUT PLAN", 50, y);
      y += 30;

      doc.moveTo(50, y).lineTo(545, y).stroke(GOLD);
      y += 15;

      for (const day of programData.workout_plan.days) {
        if (y > 720) { doc.addPage(); y = 50; }

        doc.fontSize(13).fill(GOLD).font("Helvetica-Bold")
          .text(`${day.day} — ${day.focus}`, 50, y);
        y += 20;

        if (day.exercises) {
          for (const ex of day.exercises) {
            if (y > 720) { doc.addPage(); y = 50; }
            doc.fontSize(10).fill(CHARCOAL).font("Helvetica")
              .text(`• ${ex.name}`, 65, y);
            doc.fill("#6B6B6B")
              .text(`${ex.sets} sets × ${ex.reps} | Rest: ${ex.rest || "60s"}`, 250, y);
            y += 16;
            if (ex.notes) {
              doc.fontSize(8).fill("#999999")
                .text(`  ${ex.notes}`, 75, y);
              y += 14;
            }
          }
        }
        y += 10;
      }

      if (programData.workout_plan.cardio) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fontSize(10).fill(CHARCOAL).font("Helvetica-Bold")
          .text("Cardio:", 50, y);
        doc.font("Helvetica").text(programData.workout_plan.cardio, 100, y);
        y += 20;
      }
    }

    if (programData.nutrition_plan) {
      if (y > 600) { doc.addPage(); y = 50; }

      y += 10;
      doc.fontSize(18).fill(CHARCOAL).font("Helvetica-Bold")
        .text("NUTRITION PLAN", 50, y);
      y += 30;
      doc.moveTo(50, y).lineTo(545, y).stroke(GOLD);
      y += 15;

      const np = programData.nutrition_plan;
      doc.fontSize(11).fill(CHARCOAL).font("Helvetica-Bold");
      const macroLine = `${np.calories} kcal | P: ${np.protein_g}g | C: ${np.carbs_g}g | F: ${np.fat_g}g`;
      doc.text(macroLine, 50, y);
      y += 25;

      if (np.meals) {
        for (const meal of np.meals) {
          if (y > 720) { doc.addPage(); y = 50; }
          doc.fontSize(11).fill(GOLD).font("Helvetica-Bold")
            .text(meal.meal, 50, y);
          y += 16;
          if (meal.options) {
            for (const opt of meal.options) {
              doc.fontSize(9).fill(CHARCOAL).font("Helvetica")
                .text(`• ${opt}`, 65, y);
              y += 14;
            }
          }
          y += 6;
        }
      }

      if (np.supplements && np.supplements.length > 0) {
        if (y > 720) { doc.addPage(); y = 50; }
        y += 5;
        doc.fontSize(11).fill(CHARCOAL).font("Helvetica-Bold")
          .text("Supplements:", 50, y);
        y += 16;
        for (const s of np.supplements) {
          doc.fontSize(9).fill(CHARCOAL).font("Helvetica")
            .text(`• ${s}`, 65, y);
          y += 14;
        }
      }
    }

    if (y > 720) { doc.addPage(); y = 50; }
    y += 20;
    doc.rect(50, y, 495, 40).fill("#FAF8F4");
    doc.fontSize(8).fill("#6B6B6B").font("Helvetica")
      .text("Generated by Fitness by Maddy coaching system. For questions, reach out on WhatsApp.", 60, y + 14);

    doc.end();
  });
}
