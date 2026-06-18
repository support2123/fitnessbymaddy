const { getSupabase } = require("./_lib/supabase");
const { sendWhatsApp } = require("./_lib/whatsapp");
const { notifyMaddy } = require("./_lib/escalation");
const Anthropic = require("@anthropic-ai/sdk");
const PDFDocument = require("pdfkit");

// ── Brand colours ────────────────────────────────────────────────────────
const BRAND = {
  black: "#2C2C2C",
  gold: "#B8965A",
  cream: "#FAF8F4",
  white: "#FFFFFF",
};

// ── Safety constants ─────────────────────────────────────────────────────
const MIN_CALORIES = 1200;
const BANNED_TERMS = [
  "steroid",
  "anabolic",
  "dnp",
  "clenbuterol",
  "ephedra",
  "sarm",
  "hgh",
  "testosterone injection",
  "dinitrophenol",
];

// ── CORS helper ──────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── System prompt for Claude ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert fitness program architect for FitnessByMaddy, a premium online coaching business. Generate a weekly workout and nutrition plan based on the client's profile and recent check-in data. Output valid JSON with two keys: workout_plan (array of day objects with exercises, sets, reps, rest) and nutrition_plan (object with daily_calories, protein_g, carbs_g, fat_g, meal_suggestions array). Be evidence-based, progressive, and safe. Never suggest extreme calorie cuts below 1200cal, banned substances, or unrealistic timelines.`;

/**
 * POST /api/generate-program
 *
 * Body: { client_id, week_no? }
 *
 * Generates a personalised weekly workout + nutrition plan using Claude,
 * renders it as a branded PDF, uploads to Supabase Storage, and sends
 * the link to the client via WhatsApp.
 */
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const { client_id } = body;

    if (!client_id) {
      return res.status(400).json({ error: "client_id is required" });
    }

    const supabase = getSupabase();

    // ── Fetch client profile ───────────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      console.error("[generate-program] Client not found:", clientErr?.message);
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.status !== "active") {
      return res.status(400).json({ error: "Client is not active" });
    }

    // ── Calculate week number ──────────────────────────────────────────
    let weekNo = body.week_no;
    if (!weekNo && client.program_started_at) {
      const startedAt = new Date(client.program_started_at);
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      weekNo = Math.floor((Date.now() - startedAt.getTime()) / msPerWeek) + 1;
    }
    weekNo = weekNo || 1;

    // ── Fetch last 2 check-ins ─────────────────────────────────────────
    const { data: checkins, error: checkinErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error("[generate-program] Failed to fetch checkins:", checkinErr.message);
    }

    // ── Build user prompt ──────────────────────────────────────────────
    const clientProfile = {
      name: client.name,
      age: client.age,
      gender: client.gender,
      height_cm: client.height_cm,
      weight_kg: client.weight_kg,
      goal: client.goal,
      program: client.program,
      fitness_level: client.fitness_level,
      equipment: client.equipment,
      dietary_restrictions: client.dietary_restrictions,
      medical_conditions: client.medical_conditions,
      week_number: weekNo,
    };

    const userPrompt = [
      `Generate the Week ${weekNo} program for this client.`,
      "",
      "CLIENT PROFILE:",
      JSON.stringify(clientProfile, null, 2),
      "",
      "RECENT CHECK-INS:",
      checkins && checkins.length > 0
        ? JSON.stringify(checkins, null, 2)
        : "No previous check-ins available.",
      "",
      "Respond with ONLY valid JSON. No markdown, no code fences.",
    ].join("\n");

    // ── Call Claude API ────────────────────────────────────────────────
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract text from response
    const rawText = aiResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Parse JSON — handle potential code fences
    let programData;
    try {
      const cleaned = rawText
        .replace(/^```json?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      programData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[generate-program] Failed to parse Claude response:", parseErr.message);
      console.error("[generate-program] Raw response:", rawText.substring(0, 500));
      return res.status(500).json({ error: "Failed to parse AI response" });
    }

    const { workout_plan, nutrition_plan } = programData;

    if (!workout_plan || !nutrition_plan) {
      console.error("[generate-program] Missing workout_plan or nutrition_plan in AI response");
      return res.status(500).json({ error: "Incomplete AI response" });
    }

    // ── Safety checks ──────────────────────────────────────────────────
    if (nutrition_plan.daily_calories && nutrition_plan.daily_calories < MIN_CALORIES) {
      console.warn(
        `[generate-program] SAFETY: Calories ${nutrition_plan.daily_calories} below minimum ${MIN_CALORIES} for client ${client_id}`
      );
      await notifyMaddy("Program safety flag — calories too low", {
        phone: client.phone,
        message: `Generated program for client ${client.name} (week ${weekNo}) has ${nutrition_plan.daily_calories} calories, below the ${MIN_CALORIES} minimum. Flagged for manual review.`,
        leadId: client_id,
      });
      return res.status(400).json({
        error: "Program flagged for safety review — calories below minimum",
        flagged: true,
      });
    }

    const jsonLower = JSON.stringify(programData).toLowerCase();
    const bannedMatch = BANNED_TERMS.find((term) => jsonLower.includes(term));
    if (bannedMatch) {
      console.warn(
        `[generate-program] SAFETY: Banned term "${bannedMatch}" found for client ${client_id}`
      );
      await notifyMaddy("Program safety flag — banned substance", {
        phone: client.phone,
        message: `Generated program for client ${client.name} (week ${weekNo}) contains banned term "${bannedMatch}". Flagged for manual review.`,
        leadId: client_id,
      });
      return res.status(400).json({
        error: "Program flagged for safety review — contains banned content",
        flagged: true,
      });
    }

    // ── Generate PDF ───────────────────────────────────────────────────
    const pdfBuffer = await generatePDF(client, weekNo, workout_plan, nutrition_plan);

    // ── Upload to Supabase Storage ─────────────────────────────────────
    const storagePath = `clients/${client_id}/week_${weekNo}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("programs")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[generate-program] Upload failed:", uploadErr.message);
      return res.status(500).json({ error: "Failed to upload PDF" });
    }

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from("programs")
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || `${process.env.SUPABASE_URL}/storage/v1/object/public/programs/${storagePath}`;

    // ── Insert program record ──────────────────────────────────────────
    const { data: program, error: insertErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no: weekNo,
        workout_plan,
        nutrition_plan,
        pdf_url: pdfUrl,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[generate-program] Insert failed:", insertErr.message);
      return res.status(500).json({ error: "Failed to save program record" });
    }

    // ── Send PDF via WhatsApp ──────────────────────────────────────────
    try {
      await sendWhatsApp(client.phone, "program_ready", [
        client.name || "there",
        String(weekNo),
        pdfUrl,
      ]);
    } catch (whatsappErr) {
      console.error("[generate-program] WhatsApp send failed:", whatsappErr.message);
      // Non-fatal — the PDF is still saved
    }

    console.log(
      `[generate-program] Generated week ${weekNo} program for client ${client_id} (program_id: ${program.id})`
    );

    return res.status(200).json({
      success: true,
      pdf_url: pdfUrl,
      program_id: program.id,
    });
  } catch (err) {
    console.error("[generate-program] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// =========================================================================
// PDF Generation
// =========================================================================

/**
 * Generate a branded PDF for the weekly program.
 *
 * @param {object} client        Client row from Supabase
 * @param {number} weekNo        Week number
 * @param {Array}  workoutPlan   Array of day objects
 * @param {object} nutritionPlan Nutrition plan object
 * @returns {Promise<Buffer>}    PDF as a Buffer
 */
function generatePDF(client, weekNo, workoutPlan, nutritionPlan) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - 100; // minus margins

      // ── Page 1: Header ─────────────────────────────────────────────
      // Black header block
      doc.rect(0, 0, doc.page.width, 160).fill(BRAND.black);

      // Gold accent line
      doc.rect(50, 130, pageWidth, 3).fill(BRAND.gold);

      // Title
      doc
        .font("Helvetica-Bold")
        .fontSize(28)
        .fillColor(BRAND.gold)
        .text("FITNESS BY MADDY", 50, 45, { width: pageWidth });

      // Subtitle
      doc
        .font("Helvetica")
        .fontSize(12)
        .fillColor(BRAND.cream)
        .text("YOUR PERSONALISED WEEKLY PROGRAM", 50, 85, { width: pageWidth });

      // Client info line
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor(BRAND.white)
        .text(
          `${(client.name || "Client").toUpperCase()}  |  WEEK ${weekNo}  |  ${formatDate(new Date())}`,
          50,
          105,
          { width: pageWidth }
        );

      let yPos = 185;

      // ── Workout Plan Section ───────────────────────────────────────
      yPos = drawSectionHeader(doc, "WORKOUT PLAN", yPos, pageWidth);

      if (Array.isArray(workoutPlan)) {
        for (const day of workoutPlan) {
          // Check if we need a new page
          if (yPos > doc.page.height - 150) {
            doc.addPage();
            yPos = 50;
          }

          // Day header
          const dayLabel =
            day.day || day.name || `Day ${workoutPlan.indexOf(day) + 1}`;
          yPos = drawDayHeader(doc, dayLabel.toUpperCase(), yPos, pageWidth);

          // Rest day check
          if (day.rest || day.is_rest_day) {
            doc
              .font("Helvetica")
              .fontSize(11)
              .fillColor("#666666")
              .text("Rest & Recovery — active stretching recommended", 70, yPos);
            yPos += 25;
            continue;
          }

          // Exercises
          const exercises = day.exercises || [];
          for (const ex of exercises) {
            if (yPos > doc.page.height - 80) {
              doc.addPage();
              yPos = 50;
            }

            const exerciseName = ex.name || ex.exercise || "Exercise";
            const sets = ex.sets || "";
            const reps = ex.reps || "";
            const rest = ex.rest || "";

            // Exercise name
            doc
              .font("Helvetica-Bold")
              .fontSize(10)
              .fillColor(BRAND.black)
              .text(`• ${exerciseName}`, 70, yPos, { width: pageWidth - 40 });
            yPos += 15;

            // Details line
            const details = [
              sets ? `${sets} sets` : null,
              reps ? `${reps} reps` : null,
              rest ? `${rest} rest` : null,
            ]
              .filter(Boolean)
              .join("  ·  ");

            if (details) {
              doc
                .font("Helvetica")
                .fontSize(9)
                .fillColor("#666666")
                .text(details, 85, yPos, { width: pageWidth - 55 });
              yPos += 15;
            }

            // Notes
            if (ex.notes) {
              doc
                .font("Helvetica-Oblique")
                .fontSize(8)
                .fillColor("#888888")
                .text(ex.notes, 85, yPos, { width: pageWidth - 55 });
              yPos += 14;
            }
          }

          yPos += 10; // spacing between days
        }
      }

      // ── Nutrition Plan Section ─────────────────────────────────────
      if (yPos > doc.page.height - 250) {
        doc.addPage();
        yPos = 50;
      }

      yPos = drawSectionHeader(doc, "NUTRITION PLAN", yPos + 10, pageWidth);

      // Macros summary bar
      yPos = drawMacrosBar(doc, nutritionPlan, yPos, pageWidth);

      // Meal suggestions
      const meals = nutritionPlan.meal_suggestions || [];
      if (meals.length > 0) {
        yPos += 10;
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor(BRAND.black)
          .text("MEAL SUGGESTIONS", 50, yPos);
        yPos += 20;

        for (const meal of meals) {
          if (yPos > doc.page.height - 80) {
            doc.addPage();
            yPos = 50;
          }

          if (typeof meal === "string") {
            doc
              .font("Helvetica")
              .fontSize(10)
              .fillColor(BRAND.black)
              .text(`• ${meal}`, 70, yPos, { width: pageWidth - 40 });
            yPos += 18;
          } else if (typeof meal === "object" && meal !== null) {
            const mealName = meal.name || meal.meal || "Meal";
            const mealDesc = meal.description || meal.items || "";

            doc
              .font("Helvetica-Bold")
              .fontSize(10)
              .fillColor(BRAND.black)
              .text(`• ${mealName}`, 70, yPos, { width: pageWidth - 40 });
            yPos += 15;

            if (mealDesc) {
              const descText = Array.isArray(mealDesc) ? mealDesc.join(", ") : String(mealDesc);
              doc
                .font("Helvetica")
                .fontSize(9)
                .fillColor("#666666")
                .text(descText, 85, yPos, { width: pageWidth - 55 });
              yPos += 15;
            }

            // Macros per meal
            const mealMacros = [
              meal.calories ? `${meal.calories} cal` : null,
              meal.protein_g ? `${meal.protein_g}g protein` : null,
              meal.carbs_g ? `${meal.carbs_g}g carbs` : null,
              meal.fat_g ? `${meal.fat_g}g fat` : null,
            ]
              .filter(Boolean)
              .join("  ·  ");

            if (mealMacros) {
              doc
                .font("Helvetica")
                .fontSize(8)
                .fillColor(BRAND.gold)
                .text(mealMacros, 85, yPos, { width: pageWidth - 55 });
              yPos += 14;
            }
          }
        }
      }

      // ── Footer on every page ───────────────────────────────────────
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);

        // Gold line above footer
        doc
          .rect(50, doc.page.height - 45, pageWidth, 1)
          .fill(BRAND.gold);

        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#999999")
          .text(
            "Fitness by Maddy  |  fitnessbymaddy.com",
            50,
            doc.page.height - 35,
            { width: pageWidth, align: "center" }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── PDF drawing helpers ──────────────────────────────────────────────────

function drawSectionHeader(doc, title, yPos, pageWidth) {
  // Gold background bar
  doc.rect(50, yPos, pageWidth, 30).fill(BRAND.gold);

  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor(BRAND.white)
    .text(title, 60, yPos + 8, { width: pageWidth - 20 });

  return yPos + 45;
}

function drawDayHeader(doc, label, yPos, pageWidth) {
  // Dark background strip
  doc.rect(60, yPos, pageWidth - 20, 22).fill(BRAND.black);

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(BRAND.gold)
    .text(label, 70, yPos + 6, { width: pageWidth - 40 });

  return yPos + 30;
}

function drawMacrosBar(doc, nutrition, yPos, pageWidth) {
  const macros = [
    { label: "CALORIES", value: nutrition.daily_calories || "—", unit: "kcal" },
    { label: "PROTEIN", value: nutrition.protein_g || "—", unit: "g" },
    { label: "CARBS", value: nutrition.carbs_g || "—", unit: "g" },
    { label: "FAT", value: nutrition.fat_g || "—", unit: "g" },
  ];

  // Background bar
  doc.rect(50, yPos, pageWidth, 55).fill(BRAND.cream);

  const colWidth = pageWidth / macros.length;

  macros.forEach((macro, i) => {
    const x = 50 + i * colWidth;

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#999999")
      .text(macro.label, x, yPos + 8, { width: colWidth, align: "center" });

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(BRAND.gold)
      .text(String(macro.value), x, yPos + 20, { width: colWidth, align: "center" });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#999999")
      .text(macro.unit, x, yPos + 42, { width: colWidth, align: "center" });
  });

  return yPos + 65;
}

function formatDate(date) {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}
