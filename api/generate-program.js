const Anthropic = require("anthropic").default || require("anthropic");
const PDFDocument = require("pdfkit");
const supabase = require("../lib/supabase");
const { sendText } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/helpers");
const { notifyMaddy } = require("../lib/escalate");

const BRAND_GOLD = "#B8965A";
const BRAND_BLACK = "#111111";

module.exports = async function handler(req, res) {
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

    // ── 1. Fetch client profile ────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      console.error("Client not found:", clientErr?.message);
      return res.status(404).json({ error: "Client not found" });
    }

    // ── 2. Fetch last 2 check-ins ─────────────────────────────────
    const { data: checkins, error: ciErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (ciErr) {
      console.error("Checkins fetch failed:", ciErr.message);
    }

    const recentCheckins = (checkins || []).reverse();

    // ── 3. Build Claude prompt ─────────────────────────────────────
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(client, recentCheckins, week_no);

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    // ── 4. Parse the response ──────────────────────────────────────
    const rawText =
      message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("") || "";

    let programData;
    try {
      // Extract JSON from response (may be wrapped in markdown code fences)
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      programData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("Failed to parse Claude response as JSON:", parseErr.message);
      console.error("Raw response (first 500 chars):", rawText.slice(0, 500));
      return res.status(500).json({ error: "Failed to parse program response" });
    }

    const { workout_plan, nutrition_plan } = programData;

    if (!workout_plan || !nutrition_plan) {
      return res
        .status(500)
        .json({ error: "Invalid program structure from AI" });
    }

    // ── 5. Safety checks ───────────────────────────────────────────
    const safetyIssue = checkSafety(programData);
    if (safetyIssue) {
      await notifyMaddy("Program safety flag", {
        phone: maskPhone(client.phone),
        context: `Week ${week_no} program for ${client.name || "Unknown"} flagged: ${safetyIssue}`,
      });
      return res.status(200).json({
        flagged: true,
        reason: safetyIssue,
        message: "Program flagged for manual review",
      });
    }

    // ── 6. Generate PDF ────────────────────────────────────────────
    const pdfBuffer = await generatePDF(client, week_no, programData);

    // ── 7. Upload to Supabase Storage ──────────────────────────────
    const storagePath = `${client_id}/week_${week_no}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("clients")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("PDF upload failed:", uploadErr.message);
      return res.status(500).json({ error: "Failed to upload program PDF" });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("clients")
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || null;

    // ── 8. Insert into programs table ──────────────────────────────
    const { error: insertErr } = await supabase.from("programs").insert({
      client_id,
      week_no,
      pdf_url: pdfUrl,
      workout_plan,
      nutrition_plan,
      notes: programData.notes || null,
    });

    if (insertErr) {
      console.error("Program insert failed:", insertErr.message);
      return res.status(500).json({ error: "Failed to save program" });
    }

    // ── 9. Send PDF link via WhatsApp ──────────────────────────────
    const focus =
      programData.next_week_focus ||
      nutrition_plan.focus ||
      "consistency and recovery";

    const whatsappMsg = [
      `Your Week ${week_no} program is ready! \u{1F4AA}`,
      `Focus: ${focus}`,
      "",
      pdfUrl,
    ].join("\n");

    const sendResult = await sendText(client.phone, whatsappMsg);

    // Update whatsapp_sent_at if sent successfully
    if (sendResult.success) {
      await supabase
        .from("programs")
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq("client_id", client_id)
        .eq("week_no", week_no);
    }

    console.log(
      `Program generated: ${maskPhone(client.phone)} week ${week_no}, sent=${sendResult.success}`
    );

    return res.status(200).json({
      success: true,
      pdf_url: pdfUrl,
      whatsapp_sent: sendResult.success,
    });
  } catch (err) {
    console.error("generate-program error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ── Helper: Build system prompt ──────────────────────────────────────

function buildSystemPrompt() {
  return `You are an expert fitness coach and program architect for "Fitness by Maddy", a premium coaching service. Your job is to create personalized weekly training and nutrition programs.

RULES:
- Output ONLY valid JSON with no extra text outside the JSON.
- The JSON must have these top-level keys: "workout_plan", "nutrition_plan", and optionally "next_week_focus" and "notes".
- workout_plan: an object with keys "day_1" through "day_7". Each day is an object with:
  - "name": day label (e.g. "Monday - Upper Body Push")
  - "type": "training" | "active_recovery" | "rest"
  - "exercises": array of objects with "name", "sets", "reps", "rest_seconds", and optional "notes"
  - Include 1-2 rest or active recovery days per week.
- nutrition_plan: an object with:
  - "daily_calories": number (NEVER below 1200)
  - "protein_g": number
  - "carbs_g": number
  - "fat_g": number
  - "meals": array of objects with "name" (e.g. "Breakfast"), "suggestion", "calories"
  - "hydration_liters": number
  - Optional "focus": string describing the nutritional focus for the week
- SAFETY: Never prescribe calories below 1200. Never mention banned/illegal substances (steroids, SARMs, DNP, clenbuterol, etc.). Never suggest extreme or unsafe protocols. Set realistic timelines — no more than 1kg/week fat loss.
- Tailor the program to the client's profile, goals, and check-in feedback.
- Week context: Weeks 1-3 are foundation (build habits, assess capacity). Weeks 4-8 are progression (increase intensity). Weeks 9-12 are peak (highest intensity, then taper in week 12).`;
}

// ── Helper: Build user prompt ────────────────────────────────────────

function buildUserPrompt(client, checkins, weekNo) {
  const profile = [
    `Client: ${client.name || "Anonymous"}`,
    `Program: ${client.program}`,
    `Week: ${weekNo} of 12`,
    client.email ? `Email: ${client.email}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let checkinSummary = "No previous check-in data available.";
  if (checkins.length > 0) {
    checkinSummary = checkins
      .map((ci) => {
        const parts = [
          `Week ${ci.week_no}:`,
          ci.weight != null ? `Weight: ${ci.weight}kg` : null,
          ci.compliance_score != null
            ? `Compliance: ${ci.compliance_score}/10`
            : null,
          ci.energy != null ? `Energy: ${ci.energy}/10` : null,
          ci.issues ? `Issues: ${ci.issues}` : null,
          ci.next_week_focus ? `Previous focus: ${ci.next_week_focus}` : null,
        ];
        return parts.filter(Boolean).join(", ");
      })
      .join("\n");
  }

  let phaseContext;
  if (weekNo <= 3) {
    phaseContext =
      "PHASE: Foundation. Focus on building habits, assessing capacity, moderate intensity.";
  } else if (weekNo <= 8) {
    phaseContext =
      "PHASE: Progression. Increase intensity and volume. Push boundaries while managing recovery.";
  } else {
    phaseContext =
      "PHASE: Peak & Taper. Highest intensity in weeks 9-11, begin deload in week 12.";
  }

  return `Generate a Week ${weekNo} program for this client.

CLIENT PROFILE:
${profile}

RECENT CHECK-INS:
${checkinSummary}

${phaseContext}

Return ONLY the JSON object.`;
}

// ── Helper: Safety checks ────────────────────────────────────────────

function checkSafety(programData) {
  const { nutrition_plan } = programData;

  if (nutrition_plan && nutrition_plan.daily_calories < 1200) {
    return `Calories too low: ${nutrition_plan.daily_calories}`;
  }

  // Check for banned substances in all string values
  const banned = [
    "steroid",
    "sarm",
    "dnp",
    "clenbuterol",
    "dianabol",
    "trenbolone",
    "anavar",
    "testosterone injection",
    "hgh injection",
    "ephedra",
  ];

  const fullText = JSON.stringify(programData).toLowerCase();
  for (const substance of banned) {
    if (fullText.includes(substance)) {
      return `Banned substance reference: ${substance}`;
    }
  }

  return null;
}

// ── Helper: Generate PDF ─────────────────────────────────────────────

function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { workout_plan, nutrition_plan } = programData;
    const pageWidth = doc.page.width;
    const marginLeft = 50;
    const contentWidth = pageWidth - 2 * marginLeft;

    // ── Header ──────────────────────────────────────────────────
    doc.rect(0, 0, pageWidth, 100).fill(BRAND_BLACK);
    doc
      .fontSize(24)
      .fill(BRAND_GOLD)
      .text(
        `Week ${weekNo} Program`,
        marginLeft,
        30,
        { width: contentWidth, align: "center" }
      );
    doc
      .fontSize(14)
      .fill("#FFFFFF")
      .text(
        client.name || "Client",
        marginLeft,
        62,
        { width: contentWidth, align: "center" }
      );

    doc.moveDown(2);
    let y = 130;

    // ── Workout Plan Section ────────────────────────────────────
    doc.fontSize(18).fill(BRAND_GOLD).text("WORKOUT PLAN", marginLeft, y);
    y += 30;

    const days = Object.keys(workout_plan).sort();
    for (const dayKey of days) {
      const day = workout_plan[dayKey];

      // Check if we need a new page
      if (y > doc.page.height - 150) {
        doc.addPage();
        y = 50;
      }

      // Day header
      doc
        .fontSize(13)
        .fill(BRAND_BLACK)
        .text(day.name || dayKey, marginLeft, y, { underline: true });
      y += 20;

      if (day.type === "rest") {
        doc.fontSize(10).fill("#555555").text("Rest Day", marginLeft + 10, y);
        y += 20;
      } else if (day.type === "active_recovery") {
        doc
          .fontSize(10)
          .fill("#555555")
          .text("Active Recovery", marginLeft + 10, y);
        y += 15;
        if (day.exercises && day.exercises.length > 0) {
          for (const ex of day.exercises) {
            const line = `${ex.name}${ex.notes ? " — " + ex.notes : ""}`;
            doc.fontSize(9).fill("#333333").text(line, marginLeft + 20, y);
            y += 14;
          }
        }
      } else if (day.exercises) {
        for (const ex of day.exercises) {
          const detail = [
            `${ex.sets} x ${ex.reps}`,
            ex.rest_seconds ? `Rest: ${ex.rest_seconds}s` : null,
            ex.notes || null,
          ]
            .filter(Boolean)
            .join("  |  ");
          doc.fontSize(10).fill("#333333").text(`• ${ex.name}`, marginLeft + 10, y);
          y += 14;
          doc.fontSize(8).fill("#777777").text(detail, marginLeft + 20, y);
          y += 14;
        }
      }
      y += 10;
    }

    // ── Nutrition Plan Section ──────────────────────────────────
    if (y > doc.page.height - 200) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(18).fill(BRAND_GOLD).text("NUTRITION PLAN", marginLeft, y);
    y += 30;

    // Macros summary
    doc
      .fontSize(11)
      .fill(BRAND_BLACK)
      .text(
        `Daily Calories: ${nutrition_plan.daily_calories} kcal`,
        marginLeft,
        y
      );
    y += 18;
    doc
      .fontSize(10)
      .fill("#333333")
      .text(
        `Protein: ${nutrition_plan.protein_g}g  |  Carbs: ${nutrition_plan.carbs_g}g  |  Fat: ${nutrition_plan.fat_g}g`,
        marginLeft,
        y
      );
    y += 18;

    if (nutrition_plan.hydration_liters) {
      doc
        .fontSize(10)
        .fill("#333333")
        .text(
          `Hydration: ${nutrition_plan.hydration_liters}L per day`,
          marginLeft,
          y
        );
      y += 18;
    }

    if (nutrition_plan.focus) {
      doc
        .fontSize(10)
        .fill("#555555")
        .text(`Focus: ${nutrition_plan.focus}`, marginLeft, y);
      y += 18;
    }

    y += 10;

    // Meal suggestions
    if (nutrition_plan.meals && nutrition_plan.meals.length > 0) {
      doc.fontSize(12).fill(BRAND_BLACK).text("Meal Suggestions", marginLeft, y);
      y += 20;

      for (const meal of nutrition_plan.meals) {
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 50;
        }

        doc
          .fontSize(10)
          .fill(BRAND_BLACK)
          .text(
            `${meal.name}${meal.calories ? " (" + meal.calories + " kcal)" : ""}`,
            marginLeft + 10,
            y
          );
        y += 14;
        doc
          .fontSize(9)
          .fill("#555555")
          .text(meal.suggestion, marginLeft + 20, y, {
            width: contentWidth - 20,
          });
        y += doc.heightOfString(meal.suggestion, { width: contentWidth - 20, fontSize: 9 }) + 8;
      }
    }

    // ── Footer ──────────────────────────────────────────────────
    const footerY = doc.page.height - 40;
    doc
      .fontSize(8)
      .fill("#999999")
      .text(
        "Fitness by Maddy | fitnessbymaddy.com",
        marginLeft,
        footerY,
        { width: contentWidth, align: "center" }
      );

    doc.end();
  });
}
