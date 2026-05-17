const Anthropic = require("@anthropic-ai/sdk");
const PDFDocument = require("pdfkit");
const { getSupabase } = require("./_lib/supabase");
const { sendTextMessage } = require("./_lib/whatsapp");
const { notifyMaddy } = require("./_lib/escalation");

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BRAND = {
  black: "#2C2C2C",
  gold: "#B8965A",
  white: "#FFFFFF",
  lightGray: "#F5F5F0",
};

const BANNED_SUBSTANCES = [
  "steroids",
  "clenbuterol",
  "dnp",
  "ephedra",
  "dinitrophenol",
  "anabolic",
  "sarms",
  "hgh",
  "human growth hormone",
];

const MIN_CALORIES_FEMALE = 1200;
const MIN_CALORIES_MALE = 1500;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Mask a phone number for safe logging.
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  const str = String(phone);
  if (str.length <= 3) return "***";
  return "*".repeat(str.length - 3) + str.slice(-3);
}

/**
 * Safety check: scan the generated plan for risky content.
 * @param {object} plan - parsed JSON from Claude
 * @param {string} gender - client gender
 * @returns {{ safe: boolean, reason: string }}
 */
function safetyCheck(plan, gender) {
  const planStr = JSON.stringify(plan).toLowerCase();

  // Check banned substances
  for (const substance of BANNED_SUBSTANCES) {
    if (planStr.includes(substance)) {
      return { safe: false, reason: `Banned substance detected: ${substance}` };
    }
  }

  // Check extreme calorie deficits
  const calories = plan.nutrition_plan && plan.nutrition_plan.calories;
  if (calories) {
    const lowerGender = (gender || "").toLowerCase();
    const isFemale =
      lowerGender === "female" || lowerGender === "f" || lowerGender === "woman";
    const threshold = isFemale ? MIN_CALORIES_FEMALE : MIN_CALORIES_MALE;

    if (calories < threshold) {
      return {
        safe: false,
        reason: `Extreme calorie deficit: ${calories} kcal (minimum ${threshold} for ${isFemale ? "women" : "men"})`,
      };
    }
  }

  return { safe: true, reason: "" };
}

/**
 * Build the user message for Claude from client data.
 */
function buildUserMessage(client, checkins, intakeData, weekNo) {
  let msg = `Generate a Week ${weekNo} program for this client.\n\n`;

  msg += `## Client Profile\n`;
  msg += `- Name: ${client.name || "N/A"}\n`;
  msg += `- Phone: ${maskPhone(client.phone)}\n`;
  msg += `- Program: ${client.program || "general"}\n`;
  if (client.weight) msg += `- Current Weight: ${client.weight}\n`;
  if (client.goal) msg += `- Goal: ${client.goal}\n`;
  if (client.gender) msg += `- Gender: ${client.gender}\n`;

  if (intakeData) {
    msg += `\n## Intake Form Data\n`;
    try {
      const intake =
        typeof intakeData === "string" ? JSON.parse(intakeData) : intakeData;
      if (intake.age) msg += `- Age: ${intake.age}\n`;
      if (intake.height) msg += `- Height: ${intake.height}\n`;
      if (intake.current_weight) msg += `- Weight at intake: ${intake.current_weight}\n`;
      if (intake.goal) msg += `- Goal: ${intake.goal}\n`;
      if (intake.injuries) msg += `- Injuries/Conditions: ${intake.injuries}\n`;
      if (intake.diet_preference)
        msg += `- Diet Preference: ${intake.diet_preference}\n`;
      if (intake.schedule) msg += `- Schedule: ${intake.schedule}\n`;
      if (intake.medical_conditions)
        msg += `- Medical Conditions: ${intake.medical_conditions}\n`;
    } catch (_) {
      msg += `- Raw data: ${String(intakeData).slice(0, 500)}\n`;
    }
  }

  if (checkins && checkins.length > 0) {
    msg += `\n## Recent Check-ins\n`;
    for (const ci of checkins) {
      msg += `\n### Week ${ci.week_no} Check-in\n`;
      if (ci.weight) msg += `- Weight: ${ci.weight}\n`;
      if (ci.compliance_score != null)
        msg += `- Compliance Score: ${ci.compliance_score}/10\n`;
      if (ci.energy_level != null)
        msg += `- Energy Level: ${ci.energy_level}/10\n`;
      if (ci.notes) msg += `- Notes: ${ci.notes}\n`;
      if (ci.issues) msg += `- Issues Reported: ${ci.issues}\n`;
    }
  }

  msg += `\nCurrent week number: ${weekNo}\n`;

  return msg;
}

/* ------------------------------------------------------------------ */
/*  PDF generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Render a branded PDF from the generated plan.
 * @param {object} plan - the parsed program JSON
 * @param {object} client - client record
 * @param {number} weekNo - week number
 * @returns {Promise<Buffer>}
 */
function generatePDF(plan, client, weekNo) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - 100; // accounting for margins

      /* ---- Header ---- */
      doc
        .rect(0, 0, doc.page.width, 120)
        .fill(BRAND.black);

      doc
        .font("Helvetica-Bold")
        .fontSize(28)
        .fillColor(BRAND.gold)
        .text("FITNESS BY MADDY", 50, 35, { width: pageWidth, align: "center" });

      doc
        .font("Helvetica")
        .fontSize(14)
        .fillColor(BRAND.white)
        .text(`Week ${weekNo} Program`, 50, 75, {
          width: pageWidth,
          align: "center",
        });

      /* ---- Client info ---- */
      doc
        .fillColor(BRAND.black)
        .font("Helvetica")
        .fontSize(11)
        .text(
          `${client.name || "Client"} | ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
          50,
          140,
          { width: pageWidth, align: "center" }
        );

      let y = 170;

      /* ---- Helper: section title ---- */
      function sectionTitle(title) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        y += 15;
        doc
          .font("Helvetica-Bold")
          .fontSize(16)
          .fillColor(BRAND.gold)
          .text(title, 50, y, { width: pageWidth });
        y += 25;
        // Underline
        doc
          .moveTo(50, y - 5)
          .lineTo(50 + pageWidth, y - 5)
          .strokeColor(BRAND.gold)
          .lineWidth(1)
          .stroke();
      }

      /* ---- Helper: body text ---- */
      function bodyText(text, indent) {
        if (y > 720) {
          doc.addPage();
          y = 50;
        }
        const x = 50 + (indent || 0);
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(BRAND.black)
          .text(text, x, y, { width: pageWidth - (indent || 0) });
        y += doc.heightOfString(text, {
          width: pageWidth - (indent || 0),
          font: "Helvetica",
          fontSize: 10,
        }) + 4;
      }

      /* ---- Helper: bold label ---- */
      function boldLabel(label, value) {
        if (y > 720) {
          doc.addPage();
          y = 50;
        }
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(BRAND.black)
          .text(label, 50, y, { continued: true })
          .font("Helvetica")
          .text(` ${value}`, { width: pageWidth });
        y += 16;
      }

      /* ---- WORKOUT PLAN ---- */
      const workout = plan.workout_plan;
      if (workout) {
        sectionTitle("WORKOUT PLAN");

        if (workout.days && Array.isArray(workout.days)) {
          for (const day of workout.days) {
            if (y > 680) {
              doc.addPage();
              y = 50;
            }

            // Day header
            doc
              .font("Helvetica-Bold")
              .fontSize(12)
              .fillColor(BRAND.black)
              .text(`${day.day} — ${day.focus || ""}`, 50, y, {
                width: pageWidth,
              });
            y += 18;

            if (day.exercises && Array.isArray(day.exercises)) {
              for (const ex of day.exercises) {
                if (y > 720) {
                  doc.addPage();
                  y = 50;
                }
                const line = `• ${ex.name}  |  ${ex.sets} sets x ${ex.reps}  |  Rest: ${ex.rest || "60s"}`;
                bodyText(line, 10);
                if (ex.notes) {
                  doc
                    .font("Helvetica-Oblique")
                    .fontSize(9)
                    .fillColor("#666666")
                    .text(`  ${ex.notes}`, 65, y, {
                      width: pageWidth - 20,
                    });
                  y += 14;
                }
              }
            }
            y += 6;
          }
        }

        if (workout.rest_days && workout.rest_days.length > 0) {
          boldLabel("Rest Days:", workout.rest_days.join(", "));
        }

        if (workout.cardio) {
          const c = workout.cardio;
          boldLabel(
            "Cardio:",
            `${c.type || "—"} | ${c.duration || "—"} | ${c.frequency || "—"}`
          );
        }
      }

      /* ---- NUTRITION PLAN ---- */
      const nutrition = plan.nutrition_plan;
      if (nutrition) {
        sectionTitle("NUTRITION PLAN");

        // Macros summary
        boldLabel("Daily Calories:", `${nutrition.calories || "—"} kcal`);
        boldLabel(
          "Macros:",
          `P: ${nutrition.protein_g || "—"}g | C: ${nutrition.carbs_g || "—"}g | F: ${nutrition.fats_g || "—"}g`
        );
        y += 4;

        if (nutrition.meals && Array.isArray(nutrition.meals)) {
          for (const meal of nutrition.meals) {
            if (y > 700) {
              doc.addPage();
              y = 50;
            }
            doc
              .font("Helvetica-Bold")
              .fontSize(10)
              .fillColor(BRAND.black)
              .text(meal.meal || "Meal", 50, y);
            y += 14;

            if (meal.options && Array.isArray(meal.options)) {
              for (const opt of meal.options) {
                bodyText(`• ${opt}`, 10);
              }
            }
            if (meal.macros) {
              doc
                .font("Helvetica-Oblique")
                .fontSize(9)
                .fillColor("#666666")
                .text(`Macros: ${meal.macros}`, 65, y, { width: pageWidth - 20 });
              y += 14;
            }
            y += 4;
          }
        }

        if (nutrition.hydration) {
          boldLabel("Hydration:", nutrition.hydration);
        }

        if (
          nutrition.supplements &&
          Array.isArray(nutrition.supplements) &&
          nutrition.supplements.length > 0
        ) {
          boldLabel("Supplements:", nutrition.supplements.join(", "));
        }
      }

      /* ---- WEEKLY FOCUS ---- */
      if (plan.weekly_focus) {
        sectionTitle("WEEKLY FOCUS");
        bodyText(plan.weekly_focus);
      }

      /* ---- COACH'S NOTE ---- */
      if (plan.coach_note) {
        sectionTitle("COACH'S NOTE");
        bodyText(plan.coach_note);
      }

      /* ---- Footer ---- */
      const footerY = doc.page.height - 40;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#999999")
        .text(
          "fitnessbymaddy.com | @fitnessbymaddy_",
          50,
          footerY,
          { width: pageWidth, align: "center" }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

module.exports = async function handler(req, res) {
  // ── CORS headers ─────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 1. Accept POST only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Parse body
  const { client_id, week_no } = req.body || {};

  // 3. Validate
  if (!client_id || week_no == null) {
    return res
      .status(400)
      .json({ error: "Missing required fields: client_id, week_no" });
  }

  const weekNo = Number(week_no);
  if (isNaN(weekNo) || weekNo < 1) {
    return res.status(400).json({ error: "week_no must be a positive number" });
  }

  console.log(
    `[generate-program] Starting generation for client=${client_id} week=${weekNo}`
  );

  try {
    const supabase = getSupabase();

    // 4. Fetch client data
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .maybeSingle();

    if (clientErr) {
      console.error(
        "[generate-program] Client fetch error:",
        clientErr.message
      );
      return res.status(500).json({ error: "Failed to fetch client data" });
    }

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // 5. Fetch last 2 checkins
    const { data: checkins, error: checkinErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error(
        "[generate-program] Checkin fetch error:",
        checkinErr.message
      );
      // Non-fatal: continue without checkin data
    }

    // 6. Fetch intake data from messages table
    let intakeContent = null;
    if (client.phone) {
      const { data: intakeMsg, error: intakeErr } = await supabase
        .from("messages")
        .select("body")
        .eq("phone", client.phone)
        .eq("template_name", "intake_form")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (intakeErr) {
        console.error(
          `[generate-program] Intake fetch error for ${maskPhone(client.phone)}:`,
          intakeErr.message
        );
      } else if (intakeMsg) {
        intakeContent = intakeMsg.body;
      }
    }

    // 7. Call Claude API
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create a personalized weekly program based on the client's profile and recent check-in data.

Rules:
- Never recommend extreme calorie deficits (below 1200 kcal for women, 1500 for men)
- Never recommend banned or dangerous supplements
- Never promise specific weight loss timelines
- Adjust based on compliance score and energy levels from check-ins
- Consider any reported injuries or issues
- Progressive overload: slightly increase intensity week over week

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "Upper Body Push", "exercises": [
        { "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "..." }
      ]}
    ],
    "rest_days": ["Sunday"],
    "cardio": { "type": "...", "duration": "...", "frequency": "..." }
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 67,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "hydration": "...",
    "supplements": ["..."]
  },
  "weekly_focus": "...",
  "coach_note": "..."
}`;

    const userMessage = buildUserMessage(
      client,
      checkins || [],
      intakeContent,
      weekNo
    );

    console.log(
      `[generate-program] Calling Claude API for client=${client_id}`
    );

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text from response
    const responseText =
      response.content &&
      response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

    if (!responseText) {
      console.error("[generate-program] Empty response from Claude");
      return res
        .status(500)
        .json({ error: "Failed to generate program — empty AI response" });
    }

    // 8. Parse Claude's response JSON
    let plan;
    try {
      // Strip markdown code fences if present
      const cleaned = responseText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      plan = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(
        "[generate-program] Failed to parse Claude response:",
        parseErr.message
      );
      console.error(
        "[generate-program] Raw response:",
        responseText.slice(0, 500)
      );
      return res
        .status(500)
        .json({ error: "Failed to parse generated program" });
    }

    // Safety check
    const safety = safetyCheck(plan, client.gender);
    if (!safety.safe) {
      console.warn(
        `[generate-program] Safety flag for client=${client_id}: ${safety.reason}`
      );

      // Escalate to Maddy
      await notifyMaddy("program_safety_flag", {
        phone: client.phone || "unknown",
        message: `Program generation flagged for client ${client.name || client_id} (week ${weekNo}): ${safety.reason}`,
      });

      return res.status(422).json({
        error: "Program flagged for manual review",
        reason: safety.reason,
      });
    }

    // 9. Generate PDF
    console.log(
      `[generate-program] Generating PDF for client=${client_id} week=${weekNo}`
    );
    const pdfBuffer = await generatePDF(plan, client, weekNo);

    // 10. Upload PDF to Supabase Storage
    const storagePath = `clients/${client_id}/week_${weekNo}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("programs")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error(
        "[generate-program] PDF upload error:",
        uploadErr.message
      );
      return res.status(500).json({ error: "Failed to upload program PDF" });
    }

    // 11. Get public URL
    const { data: urlData } = supabase.storage
      .from("programs")
      .getPublicUrl(storagePath);

    const pdfUrl = urlData && urlData.publicUrl;

    if (!pdfUrl) {
      console.error("[generate-program] Failed to get public URL for PDF");
      return res
        .status(500)
        .json({ error: "Failed to generate PDF download link" });
    }

    // 12. Insert into programs table
    const { data: programRecord, error: insertErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no: weekNo,
        generated_at: new Date().toISOString(),
        pdf_url: pdfUrl,
        workout_plan: plan.workout_plan,
        nutrition_plan: plan.nutrition_plan,
        notes: plan.coach_note || null,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error(
        "[generate-program] Program insert error:",
        insertErr.message
      );
      return res.status(500).json({ error: "Failed to save program record" });
    }

    const programId = programRecord.id;

    console.log(
      `[generate-program] Program saved: id=${programId} pdf=${pdfUrl}`
    );

    // 13. Send WhatsApp to client
    let whatsappSentAt = null;
    if (client.phone) {
      try {
        const weeklyFocus = plan.weekly_focus || "your personalized plan";
        const text =
          `Your Week ${weekNo} program is ready! 📋 ` +
          `Here's what's lined up for you this week: ${weeklyFocus}. ` +
          `Download your plan: ${pdfUrl}`;

        await sendTextMessage(client.phone, text);
        whatsappSentAt = new Date().toISOString();

        console.log(
          `[generate-program] WhatsApp sent to ${maskPhone(client.phone)}`
        );
      } catch (waErr) {
        console.error(
          `[generate-program] WhatsApp send failed for ${maskPhone(client.phone)}:`,
          waErr.message
        );
        // Non-fatal: program is already saved
      }
    }

    // 14. Update programs table with whatsapp_sent_at
    if (whatsappSentAt) {
      const { error: updateErr } = await supabase
        .from("programs")
        .update({ whatsapp_sent_at: whatsappSentAt })
        .eq("id", programId);

      if (updateErr) {
        console.error(
          "[generate-program] Failed to update whatsapp_sent_at:",
          updateErr.message
        );
        // Non-fatal
      }
    }

    // 15. Return success
    return res.status(200).json({
      status: "generated",
      program_id: programId,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error("[generate-program] Unhandled error:", err.message || err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
