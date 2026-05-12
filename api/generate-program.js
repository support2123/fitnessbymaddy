// api/generate-program.js — Generate weekly training program via Claude API + PDFKit
// POST /api/generate-program  { client_id, week_no }

const Anthropic = require("@anthropic-ai/sdk");
const PDFDocument = require("pdfkit");
const { supabase, getClient, logMessage } = require("../lib/supabase");
const { sendTemplate, maskPhone } = require("../lib/whatsapp");

// Brand colours
const BG_BLACK = "#1a1a1a";
const GOLD = "#B8965A";
const WHITE = "#FFFFFF";
const LIGHT_GRAY = "#CCCCCC";

// Safety threshold
const MIN_CALORIES = 1200;

const SYSTEM_PROMPT =
  "You are an expert fitness program designer for FitnessByMaddy coaching. " +
  "Generate a personalized week's workout and nutrition plan based on the client data provided. " +
  "Output ONLY valid JSON with these keys: workout_plan (array of 5-6 day objects, each with: day, focus, " +
  "exercises array where each exercise has name, sets, reps, rest_seconds), nutrition_plan (object with " +
  "daily_calories, protein_g, carbs_g, fat_g, meals array with name and description), notes (string with " +
  "weekly focus and any adjustments). Be safe: never recommend calorie intake below 1200, never suggest " +
  "banned substances, keep recommendations evidence-based and appropriate for the client's level.";

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { client_id, week_no } = req.body || {};

    // ── Input validation ───────────────────────────────────────────
    if (!client_id || week_no == null) {
      return res
        .status(400)
        .json({ error: "client_id and week_no are required" });
    }

    const weekNo = parseInt(week_no, 10);
    if (isNaN(weekNo) || weekNo < 1) {
      return res
        .status(400)
        .json({ error: "week_no must be a positive integer" });
    }

    // ── Fetch client profile ───────────────────────────────────────
    let client;
    try {
      client = await getClient(client_id);
    } catch {
      return res.status(404).json({ error: "Client not found" });
    }
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    console.log(
      `[generate-program] Generating week ${weekNo} for ${maskPhone(client.phone)}`
    );

    // ── Fetch last 2 checkins for context ──────────────────────────
    const { data: recentCheckins, error: checkinErr } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    if (checkinErr) throw checkinErr;

    // ── Call Claude API ─────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const userMessage = JSON.stringify({
      client: {
        name: client.name || "Client",
        program: client.program || "general fitness",
        week_no: weekNo,
      },
      checkin_history: (recentCheckins || []).map((c) => ({
        week_no: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance_score: c.compliance_score,
        energy: c.energy,
        issues: c.issues || null,
      })),
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract text content from the response
    const responseText =
      message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("") || "";

    // ── Parse JSON from response ───────────────────────────────────
    let programData;
    try {
      // Handle markdown code blocks or raw JSON
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();
      programData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error(
        "[generate-program] Failed to parse Claude response:",
        parseErr.message
      );
      console.error(
        "[generate-program] Raw response preview:",
        responseText.slice(0, 500)
      );
      return res.status(500).json({
        error: "Failed to parse program data from AI response",
      });
    }

    // ── Safety check ───────────────────────────────────────────────
    const dailyCals = programData.nutrition_plan?.daily_calories;
    if (dailyCals != null && dailyCals < MIN_CALORIES) {
      console.warn(
        `[generate-program] FLAGGED: calories ${dailyCals} < ${MIN_CALORIES} for ${maskPhone(client.phone)}`
      );

      // Save flagged program but do NOT auto-send
      const { data: flaggedProgram, error: flagErr } = await supabase
        .from("programs")
        .insert({
          client_id,
          week_no: weekNo,
          workout_plan: programData.workout_plan || [],
          nutrition_plan: programData.nutrition_plan || {},
          notes: `[FLAGGED FOR REVIEW: calories below ${MIN_CALORIES}] ${programData.notes || ""}`,
        })
        .select()
        .single();

      if (flagErr) throw flagErr;

      return res.status(200).json({
        success: true,
        program_id: flaggedProgram.id,
        pdf_url: null,
        flagged_for_review: true,
        flag_reason: `Daily calories (${dailyCals}) below minimum threshold (${MIN_CALORIES})`,
      });
    }

    // ── Generate branded PDF ───────────────────────────────────────
    const pdfBuffer = await generatePDF(client, weekNo, programData);

    // ── Upload PDF to Supabase Storage ─────────────────────────────
    const storagePath = `clients/${client_id}/week_${weekNo}.pdf`;
    const { data, error: uploadErr } = await supabase.storage
      .from("programs")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[generate-program] PDF upload error:", uploadErr.message);
      throw uploadErr;
    }

    const { data: urlData } = supabase.storage
      .from("programs")
      .getPublicUrl(storagePath);

    const pdfUrl = urlData?.publicUrl || null;

    // ── Insert into programs table ─────────────────────────────────
    const { data: program, error: insertErr } = await supabase
      .from("programs")
      .insert({
        client_id,
        week_no: weekNo,
        pdf_url: pdfUrl,
        workout_plan: programData.workout_plan || [],
        nutrition_plan: programData.nutrition_plan || {},
        notes: programData.notes || "",
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // ── Send WhatsApp with PDF link ────────────────────────────────
    try {
      await sendTemplate(client.phone, "weekly_program", {
        name: client.name || "there",
        templateParams: [client.name || "there", String(weekNo)],
        mediaUrl: pdfUrl,
        mediaFilename: `week_${weekNo}_program.pdf`,
      });

      // Update programs table with whatsapp_sent_at
      await supabase
        .from("programs")
        .update({ whatsapp_sent_at: new Date().toISOString() })
        .eq("id", program.id);

      console.log(
        `[generate-program] Program sent to ${maskPhone(client.phone)} — week ${weekNo}`
      );
    } catch (sendErr) {
      console.error(
        `[generate-program] WhatsApp send failed for ${maskPhone(client.phone)}:`,
        sendErr.message
      );
      // Program is saved; WhatsApp delivery can be retried
    }

    // ── Log message ────────────────────────────────────────────────
    await logMessage(
      client.phone,
      "out",
      `Week ${weekNo} program generated and sent. PDF: ${pdfUrl}`,
      "weekly_program"
    );

    // ── Return result ──────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      program_id: program.id,
      pdf_url: pdfUrl,
    });
  } catch (err) {
    console.error("[generate-program] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// ─────────────────────────────────────────────────────────────────────
// PDF Generation — branded black/gold layout (letter size)
// ─────────────────────────────────────────────────────────────────────
function generatePDF(client, weekNo, programData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "letter",
        margin: 50,
        bufferPages: true,
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const contentWidth = pageWidth - 100; // 50px margin each side

      // ── Page 1: Header + Workout Plan ────────────────────────────
      // Dark background
      doc.rect(0, 0, pageWidth, pageHeight).fill(BG_BLACK);

      // Gold header bar
      doc.rect(0, 0, pageWidth, 100).fill(GOLD);

      doc
        .font("Helvetica-Bold")
        .fontSize(28)
        .fillColor(BG_BLACK)
        .text("FITNESSBYMADDY", 50, 25, {
          width: contentWidth,
          align: "center",
        });

      doc
        .font("Helvetica")
        .fontSize(14)
        .fillColor(BG_BLACK)
        .text(`Week ${weekNo} Program`, 50, 60, {
          width: contentWidth,
          align: "center",
        });

      let y = 120;

      // Client info
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(LIGHT_GRAY)
        .text(`Client: ${client.name || "Client"}  |  Week ${weekNo}`, 50, y);

      y += 25;

      // ── Workout Section ──────────────────────────────────────────
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor(GOLD)
        .text("WORKOUT PLAN", 50, y);

      y += 30;

      const workoutPlan = programData.workout_plan || [];
      for (const day of workoutPlan) {
        // Check if we need a new page
        if (y > pageHeight - 120) {
          doc.addPage();
          doc.rect(0, 0, pageWidth, pageHeight).fill(BG_BLACK);
          y = 50;
        }

        // Day header with focus
        const dayLabel = day.focus
          ? `${(day.day || "Day").toUpperCase()} — ${day.focus}`
          : (day.day || "Day").toUpperCase();

        doc
          .font("Helvetica-Bold")
          .fontSize(13)
          .fillColor(GOLD)
          .text(dayLabel, 50, y);

        y += 20;

        const exercises = day.exercises || [];
        if (exercises.length === 0) {
          doc
            .font("Helvetica")
            .fontSize(11)
            .fillColor(LIGHT_GRAY)
            .text("Rest Day — Active recovery recommended", 60, y);
          y += 18;
        } else {
          for (const ex of exercises) {
            if (y > pageHeight - 60) {
              doc.addPage();
              doc.rect(0, 0, pageWidth, pageHeight).fill(BG_BLACK);
              y = 50;
            }

            const restStr =
              ex.rest_seconds != null ? `  |  Rest: ${ex.rest_seconds}s` : "";
            const line =
              `${ex.name || "Exercise"}  —  ` +
              `${ex.sets || "?"}x${ex.reps || "?"}` +
              restStr;

            doc
              .font("Helvetica")
              .fontSize(10)
              .fillColor(WHITE)
              .text(line, 60, y, { width: contentWidth - 20 });

            y += 16;
          }
        }

        y += 10;
      }

      // ── Nutrition Section ────────────────────────────────────────
      doc.addPage();
      doc.rect(0, 0, pageWidth, pageHeight).fill(BG_BLACK);

      y = 50;

      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor(GOLD)
        .text("NUTRITION PLAN", 50, y);

      y += 30;

      const nutrition = programData.nutrition_plan || {};

      // Macros overview box
      doc
        .rect(50, y, contentWidth, 60)
        .lineWidth(1)
        .strokeColor(GOLD)
        .stroke();

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor(WHITE)
        .text("DAILY TARGETS", 60, y + 8);

      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor(LIGHT_GRAY)
        .text(
          `Calories: ${nutrition.daily_calories || "—"} kcal   |   ` +
            `Protein: ${nutrition.protein_g || "—"}g   |   ` +
            `Carbs: ${nutrition.carbs_g || "—"}g   |   ` +
            `Fat: ${nutrition.fat_g || "—"}g`,
          60,
          y + 30,
          { width: contentWidth - 20 }
        );

      y += 80;

      // Meal suggestions
      const meals = nutrition.meals || [];
      for (const meal of meals) {
        if (y > pageHeight - 80) {
          doc.addPage();
          doc.rect(0, 0, pageWidth, pageHeight).fill(BG_BLACK);
          y = 50;
        }

        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor(GOLD)
          .text(meal.name || "Meal", 60, y);

        y += 16;

        if (meal.description) {
          doc
            .font("Helvetica")
            .fontSize(10)
            .fillColor(WHITE)
            .text(meal.description, 60, y, { width: contentWidth - 20 });

          y += doc.heightOfString(meal.description, {
            width: contentWidth - 20,
            fontSize: 10,
          });
        }

        y += 12;
      }

      // ── Notes section ────────────────────────────────────────────
      if (programData.notes) {
        if (y > pageHeight - 120) {
          doc.addPage();
          doc.rect(0, 0, pageWidth, pageHeight).fill(BG_BLACK);
          y = 50;
        }

        y += 10;

        doc
          .font("Helvetica-Bold")
          .fontSize(14)
          .fillColor(GOLD)
          .text("WEEKLY NOTES", 50, y);

        y += 22;

        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(WHITE)
          .text(programData.notes, 60, y, { width: contentWidth - 20 });
      }

      // ── Footer on every page ─────────────────────────────────────
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(GOLD)
          .text(
            `Generated for ${client.name || "Client"} | FitnessByMaddy`,
            50,
            doc.page.height - 40,
            { width: contentWidth, align: "center" }
          );
      }

      doc.end();
    } catch (pdfErr) {
      reject(pdfErr);
    }
  });
}
