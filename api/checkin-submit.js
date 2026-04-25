const { getSupabase } = require("../lib/supabase");
const { sendTemplate, sendText } = require("../lib/whatsapp");
const { checkEscalation } = require("../lib/escalation");
const { generateProgram } = require("../lib/program-generator");
const { generatePDF } = require("../lib/pdf-generator");

const MADDY_PHONE = process.env.MADDY_PHONE || "+917082478374";

/* ---------- helpers ---------- */

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://fitnessbymaddy.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function maskPII(text) {
  if (!text) return text;
  return text
    .replace(/\+?\d{10,15}/g, "***PHONE***")
    .replace(/[\w.-]+@[\w.-]+/g, "***EMAIL***");
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
    } = req.body || {};

    /* ---- validate required fields ---- */
    if (!client_id || week_no === undefined || week_no === null) {
      return res.status(400).json({ error: "client_id and week_no are required" });
    }

    const weekNum = Number(week_no);
    if (!Number.isInteger(weekNum) || weekNum < 1) {
      return res.status(400).json({ error: "week_no must be a positive integer" });
    }

    if (compliance_score !== undefined && compliance_score !== null) {
      const cs = Number(compliance_score);
      if (cs < 1 || cs > 10) {
        return res.status(400).json({ error: "compliance_score must be between 1 and 10" });
      }
    }

    if (energy !== undefined && energy !== null) {
      const en = Number(energy);
      if (en < 1 || en > 10) {
        return res.status(400).json({ error: "energy must be between 1 and 10" });
      }
    }

    const supabase = getSupabase();

    /* ---- validate client exists and is active ---- */
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.status !== "active") {
      return res.status(400).json({ error: "Client is not active" });
    }

    /* ---- upload photos to Supabase Storage ---- */
    const photoUrls = [];

    if (photos && Array.isArray(photos) && photos.length > 0) {
      const storagePath = `clients/${client_id}/checkin_w${weekNum}`;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];

        // If already a URL, keep as-is
        if (typeof photo === "string" && (photo.startsWith("http://") || photo.startsWith("https://"))) {
          photoUrls.push(photo);
          continue;
        }

        // Parse base64 data
        let fileBuffer;
        let contentType = "image/jpeg";

        if (typeof photo === "string") {
          const base64Match = photo.match(/^data:(image\/\w+);base64,(.+)$/);
          if (base64Match) {
            contentType = base64Match[1];
            fileBuffer = Buffer.from(base64Match[2], "base64");
          } else {
            fileBuffer = Buffer.from(photo, "base64");
          }
        } else {
          continue; // skip non-string entries
        }

        const ext = contentType.split("/")[1] || "jpg";
        const fileName = `${storagePath}/photo_${i + 1}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("fitness-files")
          .upload(fileName, fileBuffer, {
            contentType,
            upsert: true,
          });

        if (uploadErr) {
          console.error(`Photo upload failed for photo ${i + 1}:`, uploadErr.message);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("fitness-files")
          .getPublicUrl(fileName);

        if (urlData && urlData.publicUrl) {
          photoUrls.push(urlData.publicUrl);
        }
      }
    }

    /* ---- insert check-in record ---- */
    const checkinRow = {
      client_id,
      week_no: weekNum,
      form_submitted_at: new Date().toISOString(),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photoUrls.length > 0 ? photoUrls : null,
    };

    const { error: insertErr } = await supabase.from("checkins").insert(checkinRow);

    if (insertErr) {
      console.error("Check-in insert failed:", insertErr.message);
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    /* ---- check for escalation triggers in issues ---- */
    if (issues && typeof issues === "string" && issues.trim().length > 0) {
      const escalation = await checkEscalation(issues, client);
      if (escalation.escalated) {
        console.warn(
          `ESCALATION from check-in: client=${client_id}, week=${weekNum}, reason=${escalation.reason}`
        );
      }
    }

    /* ---- 12-week program: trigger program generation for next week ---- */
    const programType = (client.program || "").toLowerCase();
    const is12Week = programType.includes("12") || programType.includes("twelve") || programType.includes("flagship");

    if (is12Week) {
      try {
        // Fetch last 2 check-ins for this client (including the one just submitted)
        const { data: recentCheckins } = await supabase
          .from("checkins")
          .select("*")
          .eq("client_id", client_id)
          .order("week_no", { ascending: false })
          .limit(2);

        const result = await generateProgram(client, recentCheckins || []);
        const nextWeek = weekNum + 1;

        if (result.flagged) {
          // Log flagged program and notify Maddy
          console.warn(
            `Program FLAGGED for client=${client_id}, week=${nextWeek}: ${result.flagReason}`
          );

          await supabase.from("programs").insert({
            client_id,
            week_no: nextWeek,
            generated_at: new Date().toISOString(),
            workout_plan: result.plan ? result.plan.workout_plan || null : null,
            nutrition_plan: result.plan ? result.plan.nutrition_plan || null : null,
            notes: `FLAGGED: ${result.flagReason}`,
          });

          await sendTemplate(MADDY_PHONE, "escalation_alert", [
            client.name || "Client",
            `Program flagged (week ${nextWeek})`,
            (result.flagReason || "Unknown reason").slice(0, 200),
          ]).catch((err) => console.error("Maddy notification failed:", err.message));
        } else {
          // Generate PDF, upload, send via WhatsApp
          const pdfBuffer = await generatePDF(client, nextWeek, result.plan);

          const pdfPath = `clients/${client_id}/week_${nextWeek}.pdf`;
          const { error: pdfUploadErr } = await supabase.storage
            .from("fitness-files")
            .upload(pdfPath, pdfBuffer, {
              contentType: "application/pdf",
              upsert: true,
            });

          if (pdfUploadErr) {
            console.error("PDF upload failed:", pdfUploadErr.message);
          }

          const { data: pdfUrlData } = supabase.storage
            .from("fitness-files")
            .getPublicUrl(pdfPath);

          const pdfUrl = pdfUrlData ? pdfUrlData.publicUrl : null;

          const focus = (result.plan && result.plan.notes) || "Personalized plan ready";
          const contextNote = `Week ${nextWeek} plan ready! ${focus.slice(0, 100)}`;
          const now = new Date().toISOString();

          // Insert program record
          await supabase.from("programs").insert({
            client_id,
            week_no: nextWeek,
            generated_at: now,
            pdf_url: pdfUrl,
            whatsapp_sent_at: client.phone ? now : null,
            workout_plan: result.plan.workout_plan || null,
            nutrition_plan: result.plan.nutrition_plan || null,
            notes: contextNote,
          });

          // Send WhatsApp with PDF link
          if (pdfUrl && client.phone) {
            await sendText(
              client.phone,
              `${contextNote}\n\nDownload your plan: ${pdfUrl}`
            ).catch((err) => console.error("Program WhatsApp send failed:", err.message));
          }

          // Update the checkin record with next_week_focus
          await supabase
            .from("checkins")
            .update({ next_week_focus: focus.slice(0, 500) })
            .eq("client_id", client_id)
            .eq("week_no", weekNum);
        }
      } catch (programErr) {
        // Don't fail the entire check-in if program generation fails
        console.error("Program generation failed:", maskPII(programErr.message));
      }
    }

    /* ---- send WhatsApp acknowledgment to client ---- */
    if (client.phone) {
      await sendTemplate(client.phone, "checkin_ack", [
        client.name || "there",
        String(weekNum),
      ]).catch((err) => console.error("Ack WhatsApp failed:", err.message));
    }

    return res.status(200).json({ success: true, message: "Check-in received" });
  } catch (err) {
    console.error("checkin-submit error:", maskPII(err.message));
    // Return 200 for webhook-style endpoints even on internal errors
    return res.status(200).json({ success: false, error: "Internal error" });
  }
};
