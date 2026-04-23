const Anthropic = require("@anthropic-ai/sdk");
const PDFDocument = require("pdfkit");
const { supabase } = require("./_lib/supabase");
const { sendText, logMessage } = require("./_lib/whatsapp");
const { notifyMaddy } = require("./_lib/escalation");

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GOLD = "#B8965A";
const BLACK = "#000000";
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#F5F5F5";
const DARK_GRAY = "#333333";

const BANNED_SUBSTANCES = [
  "clenbuterol",
  "dnp",
  "dinitrophenol",
  "ephedra",
  "ephedrine",
  "sibutramine",
  "anabolic steroid",
  "testosterone enanthate",
  "trenbolone",
  "stanozolol",
  "nandrolone",
  "hgh injections",
  "sarms",
  "ostarine",
  "ligandrol",
  "rad-140",
];

const PROGRAM_DURATIONS = {
  "6wk_gym": 6,
  pcos: 6,
  "40plus": 6,
  "12wk": 12,
  zoom_trial: 1,
};

/* ------------------------------------------------------------------ */
/*  Safety checks                                                      */
/* ------------------------------------------------------------------ */

/**
 * Validate that the generated plan does not contain unsafe recommendations.
 * Returns { safe: boolean, reasons: string[] }.
 */
function validatePlan(plan) {
  const reasons = [];

  // Check calorie floor
  const calories = plan.nutrition_plan && plan.nutrition_plan.daily_calories;
  if (typeof calories === "number" && calories < 1200) {
    reasons.push(`Dangerously low calorie target: ${calories} kcal (minimum 1200)`);
  }

  // Check for banned substances in the full JSON text
  const planText = JSON.stringify(plan).toLowerCase();
  for (const substance of BANNED_SUBSTANCES) {
    if (planText.includes(substance)) {
      reasons.push(`Banned substance reference detected: "${substance}"`);
    }
  }

  // Check for unrealistic weekly weight-loss claims
  const notes = [
    plan.weekly_notes || "",
    plan.progression_notes || "",
    ...(plan.focus_areas || []),
  ]
    .join(" ")
    .toLowerCase();

  if (/lose\s+(5|6|7|8|9|\d{2,})\s*(lbs?|pounds?|kg)\s*(per|a|each)\s*week/i.test(notes)) {
    reasons.push("Unrealistic weight-loss timeline detected in notes");
  }

  return { safe: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ */
/*  Claude prompt builder                                              */
/* ------------------------------------------------------------------ */

function buildPrompt({ client, lead, checkins, weekNo, programDuration }) {
  const checkinBlock =
    checkins && checkins.length > 0
      ? checkins
          .map(
            (c) =>
              `  Week ${c.week_no}: weight=${c.weight ?? "N/A"}, waist=${c.waist ?? "N/A"}, ` +
              `compliance=${c.compliance ?? "N/A"}, energy=${c.energy ?? "N/A"}, ` +
              `issues=${c.issues || "none"}`
          )
          .join("\n")
      : "  No prior check-in data available.";

  return `You are a NASM-certified fitness program architect for FitnessByMaddy.
Create Week ${weekNo} of a ${programDuration}-week program.

Client Profile:
- Name: ${client.name || "Client"}
- Program: ${client.program || "general"}
- Goal: ${lead.goal || "general fitness"}
- Injuries/Limitations: ${lead.injuries || "none reported"}
- Diet Preference: ${lead.diet_pref || "no specific preference"}

Recent Check-in Data:
${checkinBlock}

Generate a complete weekly plan in JSON format:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "...", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "..." }
        ],
        "warmup": "...",
        "cooldown": "..."
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2200,
    "protein_g": 180,
    "carbs_g": 220,
    "fat_g": 70,
    "meals": [
      { "meal": "Breakfast", "options": ["..."], "macros": "..." }
    ],
    "supplements": ["..."],
    "hydration": "..."
  },
  "weekly_notes": "...",
  "focus_areas": ["..."],
  "progression_notes": "..."
}

Rules:
- Never prescribe extreme calorie deficits (below 1200 for women, 1500 for men)
- Never recommend banned substances or extreme supplements
- Account for any injuries mentioned
- Progressive overload from previous weeks
- Realistic and sustainable approach

Return ONLY the JSON object, no markdown fences or extra text.`;
}

/* ------------------------------------------------------------------ */
/*  PDF generation                                                     */
/* ------------------------------------------------------------------ */

function generatePDF(plan, { clientName, weekNo }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const margin = 50;
      const contentWidth = pageWidth - margin * 2;
      const today = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      /* ---------- Header bar ---------- */
      doc.rect(0, 0, pageWidth, 100).fill(BLACK);
      doc
        .font("Helvetica-Bold")
        .fontSize(24)
        .fillColor(GOLD)
        .text("FITNESSBYMADDY", margin, 25, { width: contentWidth, align: "center" });
      doc
        .font("Helvetica")
        .fontSize(14)
        .fillColor(WHITE)
        .text(`Week ${weekNo} Program`, margin, 55, { width: contentWidth, align: "center" });

      /* ---------- Client info ---------- */
      doc
        .fillColor(DARK_GRAY)
        .font("Helvetica")
        .fontSize(10)
        .text(`Prepared for: ${clientName}`, margin, 115)
        .text(`Date: ${today}`, margin, 130);

      doc.moveTo(margin, 150).lineTo(pageWidth - margin, 150).strokeColor(GOLD).lineWidth(1).stroke();

      let y = 165;

      /* ---------- Helper: section header ---------- */
      function sectionHeader(title) {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }
        doc.rect(margin, y, contentWidth, 28).fill(GOLD);
        doc
          .font("Helvetica-Bold")
          .fontSize(13)
          .fillColor(WHITE)
          .text(title.toUpperCase(), margin + 10, y + 7, { width: contentWidth - 20 });
        y += 38;
      }

      /* ---------- Helper: check page break ---------- */
      function checkPage(needed) {
        if (y + needed > doc.page.height - 80) {
          doc.addPage();
          y = 50;
        }
      }

      /* ---------- Workout Plan ---------- */
      const workout = plan.workout_plan;
      if (workout && workout.days) {
        sectionHeader("Workout Plan");

        for (const day of workout.days) {
          checkPage(80);

          // Day sub-header
          doc
            .font("Helvetica-Bold")
            .fontSize(11)
            .fillColor(GOLD)
            .text(`${day.day} — ${day.focus || ""}`, margin, y);
          y += 16;

          if (day.warmup) {
            doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY).text(`Warm-up: ${day.warmup}`, margin + 10, y, { width: contentWidth - 20 });
            y += doc.heightOfString(`Warm-up: ${day.warmup}`, { width: contentWidth - 20, fontSize: 9 }) + 4;
          }

          // Exercise table header
          if (day.exercises && day.exercises.length > 0) {
            checkPage(20);
            const colExercise = margin + 10;
            const colSets = margin + 230;
            const colReps = margin + 280;
            const colRest = margin + 340;
            const colNotes = margin + 390;

            doc.font("Helvetica-Bold").fontSize(8).fillColor(BLACK);
            doc.text("Exercise", colExercise, y);
            doc.text("Sets", colSets, y);
            doc.text("Reps", colReps, y);
            doc.text("Rest", colRest, y);
            doc.text("Notes", colNotes, y, { width: contentWidth - (colNotes - margin) });
            y += 14;

            doc.moveTo(margin + 10, y - 2).lineTo(pageWidth - margin - 10, y - 2).strokeColor(LIGHT_GRAY).lineWidth(0.5).stroke();

            for (const ex of day.exercises) {
              checkPage(16);
              doc.font("Helvetica").fontSize(8).fillColor(DARK_GRAY);
              doc.text(ex.name || "", colExercise, y, { width: 210 });
              doc.text(String(ex.sets || ""), colSets, y);
              doc.text(String(ex.reps || ""), colReps, y);
              doc.text(String(ex.rest || ""), colRest, y);
              doc.text(String(ex.notes || ""), colNotes, y, { width: contentWidth - (colNotes - margin) });
              const rowHeight = Math.max(
                14,
                doc.heightOfString(ex.name || "", { width: 210, fontSize: 8 }),
                doc.heightOfString(String(ex.notes || ""), { width: contentWidth - (colNotes - margin), fontSize: 8 })
              );
              y += rowHeight + 2;
            }
          }

          if (day.cooldown) {
            checkPage(16);
            doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY).text(`Cool-down: ${day.cooldown}`, margin + 10, y, { width: contentWidth - 20 });
            y += doc.heightOfString(`Cool-down: ${day.cooldown}`, { width: contentWidth - 20, fontSize: 9 }) + 4;
          }

          y += 10;
        }
      }

      /* ---------- Nutrition Plan ---------- */
      const nutrition = plan.nutrition_plan;
      if (nutrition) {
        sectionHeader("Nutrition Plan");

        checkPage(50);
        doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Daily Targets", margin, y);
        y += 15;

        const targets = [
          `Calories: ${nutrition.daily_calories || "—"} kcal`,
          `Protein: ${nutrition.protein_g || "—"}g`,
          `Carbs: ${nutrition.carbs_g || "—"}g`,
          `Fat: ${nutrition.fat_g || "—"}g`,
        ];

        doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY);
        for (const t of targets) {
          doc.text(t, margin + 10, y);
          y += 13;
        }
        y += 6;

        // Meals
        if (nutrition.meals && nutrition.meals.length > 0) {
          checkPage(20);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Meal Plan", margin, y);
          y += 15;

          for (const meal of nutrition.meals) {
            checkPage(30);
            doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD).text(meal.meal || "", margin + 10, y);
            y += 13;

            if (meal.options && meal.options.length > 0) {
              doc.font("Helvetica").fontSize(8).fillColor(DARK_GRAY);
              for (const opt of meal.options) {
                checkPage(14);
                doc.text(`  •  ${opt}`, margin + 15, y, { width: contentWidth - 30 });
                y += doc.heightOfString(`  •  ${opt}`, { width: contentWidth - 30, fontSize: 8 }) + 2;
              }
            }

            if (meal.macros) {
              doc.font("Helvetica").fontSize(8).fillColor(DARK_GRAY).text(`  Macros: ${meal.macros}`, margin + 15, y);
              y += 13;
            }
            y += 4;
          }
        }

        // Supplements
        if (nutrition.supplements && nutrition.supplements.length > 0) {
          checkPage(30);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Supplements", margin, y);
          y += 15;
          doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY);
          for (const s of nutrition.supplements) {
            doc.text(`  •  ${s}`, margin + 10, y, { width: contentWidth - 20 });
            y += 13;
          }
          y += 6;
        }

        // Hydration
        if (nutrition.hydration) {
          checkPage(20);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Hydration", margin, y);
          y += 15;
          doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY).text(nutrition.hydration, margin + 10, y, { width: contentWidth - 20 });
          y += doc.heightOfString(nutrition.hydration, { width: contentWidth - 20, fontSize: 9 }) + 6;
        }
      }

      /* ---------- Notes section ---------- */
      const hasNotes = plan.weekly_notes || (plan.focus_areas && plan.focus_areas.length > 0) || plan.progression_notes;
      if (hasNotes) {
        sectionHeader("Notes & Guidance");

        if (plan.weekly_notes) {
          checkPage(30);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Weekly Notes", margin, y);
          y += 15;
          doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY).text(plan.weekly_notes, margin + 10, y, { width: contentWidth - 20 });
          y += doc.heightOfString(plan.weekly_notes, { width: contentWidth - 20, fontSize: 9 }) + 8;
        }

        if (plan.focus_areas && plan.focus_areas.length > 0) {
          checkPage(30);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Focus Areas", margin, y);
          y += 15;
          doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY);
          for (const area of plan.focus_areas) {
            checkPage(14);
            doc.text(`  •  ${area}`, margin + 10, y, { width: contentWidth - 20 });
            y += doc.heightOfString(`  •  ${area}`, { width: contentWidth - 20, fontSize: 9 }) + 2;
          }
          y += 6;
        }

        if (plan.progression_notes) {
          checkPage(30);
          doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK).text("Progression Notes", margin, y);
          y += 15;
          doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY).text(plan.progression_notes, margin + 10, y, { width: contentWidth - 20 });
          y += doc.heightOfString(plan.progression_notes, { width: contentWidth - 20, fontSize: 9 }) + 8;
        }
      }

      /* ---------- Footer ---------- */
      const footerY = doc.page.height - 40;
      doc.moveTo(margin, footerY - 5).lineTo(pageWidth - margin, footerY - 5).strokeColor(GOLD).lineWidth(0.5).stroke();
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(GOLD)
        .text(`Generated for ${clientName} | fitnessbymaddy.com`, margin, footerY, {
          width: contentWidth,
          align: "center",
        });

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: "Missing client_id or week_no" });
    }

    /* ---- 1. Fetch client ---- */
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, lead_id, phone, name, email, program, status")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      console.error(`[generate-program] Client lookup failed: ${clientErr?.message || "not found"}`);
      return res.status(404).json({ error: "Client not found" });
    }

    /* ---- 2. Fetch last 2 check-ins ---- */
    const { data: checkins, error: checkinErr } = await supabase
      .from("checkins")
      .select("week_no, weight, waist, compliance, energy, issues")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinErr) {
      console.error(`[generate-program] Checkin fetch error: ${checkinErr.message}`);
    }

    /* ---- 3. Fetch lead / intake data ---- */
    let lead = { goal: null, injuries: null, diet_pref: null };

    if (client.lead_id) {
      const { data: leadRow, error: leadErr } = await supabase
        .from("leads")
        .select("goal, injuries, diet_pref")
        .eq("id", client.lead_id)
        .single();

      if (leadErr) {
        console.error(`[generate-program] Lead fetch error: ${leadErr.message}`);
      } else if (leadRow) {
        lead = leadRow;
      }
    }

    /* ---- 4-5. Call Claude API ---- */
    const programDuration = PROGRAM_DURATIONS[client.program] || 12;
    const prompt = buildPrompt({
      client,
      lead,
      checkins: checkins || [],
      weekNo: week_no,
      programDuration,
    });

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    // Extract text from response
    const rawText =
      aiResponse.content &&
      aiResponse.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

    if (!rawText) {
      console.error("[generate-program] Claude returned no text content");
      return res.status(500).json({ error: "AI returned empty response" });
    }

    // Parse JSON — strip markdown fences if present
    let plan;
    try {
      const jsonStr = rawText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      plan = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error(`[generate-program] Failed to parse AI JSON: ${parseErr.message}`);
      return res.status(500).json({ error: "Failed to parse AI response as JSON" });
    }

    /* ---- 6. Safety check ---- */
    const validation = validatePlan(plan);
    if (!validation.safe) {
      console.warn(`[generate-program] Safety check failed for client ${client_id}: ${validation.reasons.join("; ")}`);

      // Escalate to Maddy
      await notifyMaddy(
        `Program safety check failed for client ${client.name || client_id} (Week ${week_no}):\n${validation.reasons.join("\n")}`,
        { phone: client.phone, message: `Auto-generated program flagged for review — Week ${week_no}` }
      );

      return res.status(422).json({
        error: "Program flagged for manual review",
        reasons: validation.reasons,
      });
    }

    /* ---- 7. Generate PDF ---- */
    const pdfBuffer = await generatePDF(plan, {
      clientName: client.name || "Client",
      weekNo: week_no,
    });

    /* ---- 8. Upload PDF to Supabase Storage ---- */
    const storagePath = `clients/${client_id}/week_${week_no}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("files")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error(`[generate-program] PDF upload failed: ${uploadErr.message}`);
      return res.status(500).json({ error: "Failed to upload PDF" });
    }

    /* ---- 9. Get public / signed URL ---- */
    let pdfUrl;

    const { data: publicUrlData } = supabase.storage
      .from("files")
      .getPublicUrl(storagePath);

    if (publicUrlData && publicUrlData.publicUrl) {
      pdfUrl = publicUrlData.publicUrl;
    } else {
      // Fallback to a signed URL valid for 7 days
      const { data: signedData, error: signedErr } = await supabase.storage
        .from("files")
        .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

      if (signedErr) {
        console.error(`[generate-program] Signed URL failed: ${signedErr.message}`);
        return res.status(500).json({ error: "Failed to generate PDF URL" });
      }
      pdfUrl = signedData.signedUrl;
    }

    /* ---- 10. Insert / update programs table ---- */
    const { error: programErr } = await supabase
      .from("programs")
      .upsert(
        {
          client_id,
          week_no: week_no,
          workout_plan: plan.workout_plan,
          nutrition_plan: plan.nutrition_plan,
          weekly_notes: plan.weekly_notes || null,
          focus_areas: plan.focus_areas || null,
          progression_notes: plan.progression_notes || null,
          pdf_url: pdfUrl,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,week_no" }
      );

    if (programErr) {
      console.error(`[generate-program] Program upsert failed: ${programErr.message}`);
    }

    /* ---- 11. Send WhatsApp message with PDF link ---- */
    let whatsappSentAt = null;

    if (client.phone) {
      try {
        const message = `Your Week ${week_no} program is ready! Download: ${pdfUrl}`;
        await sendText(client.phone, message);
        await logMessage(client.phone, "outbound", message, null);
        whatsappSentAt = new Date().toISOString();
      } catch (waErr) {
        console.error(`[generate-program] WhatsApp send failed: ${waErr.message}`);
      }
    }

    /* ---- 12. Update whatsapp_sent_at ---- */
    if (whatsappSentAt) {
      const { error: updateErr } = await supabase
        .from("programs")
        .update({ whatsapp_sent_at: whatsappSentAt })
        .eq("client_id", client_id)
        .eq("week_no", week_no);

      if (updateErr) {
        console.error(`[generate-program] Failed to update whatsapp_sent_at: ${updateErr.message}`);
      }
    }

    /* ---- 13. Return success ---- */
    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error(`[generate-program] Unhandled error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
