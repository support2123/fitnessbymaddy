const { getSupabase } = require("../lib/supabase");
const { sendText, sendTemplate } = require("../lib/whatsapp");
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
    const { client_id, week_no } = req.body || {};

    /* ---- validate required fields ---- */
    if (!client_id || week_no === undefined || week_no === null) {
      return res.status(400).json({ error: "client_id and week_no are required" });
    }

    const weekNum = Number(week_no);
    if (!Number.isInteger(weekNum) || weekNum < 1) {
      return res.status(400).json({ error: "week_no must be a positive integer" });
    }

    const supabase = getSupabase();

    /* ---- fetch client ---- */
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    /* ---- fetch last 2 check-ins ---- */
    const { data: checkins } = await supabase
      .from("checkins")
      .select("*")
      .eq("client_id", client_id)
      .order("week_no", { ascending: false })
      .limit(2);

    /* ---- generate program via AI ---- */
    const result = await generateProgram(client, checkins || []);

    /* ---- handle flagged program ---- */
    if (result.flagged) {
      // Log flagged program in programs table
      await supabase.from("programs").insert({
        client_id,
        week_no: weekNum,
        generated_at: new Date().toISOString(),
        workout_plan: result.plan ? result.plan.workout_plan || null : null,
        nutrition_plan: result.plan ? result.plan.nutrition_plan || null : null,
        notes: `FLAGGED: ${result.flagReason}`,
      });

      // Notify Maddy about the flagged program
      await sendTemplate(MADDY_PHONE, "escalation_alert", [
        client.name || "Client",
        `Program flagged (week ${weekNum})`,
        (result.flagReason || "Unknown reason").slice(0, 200),
      ]).catch((err) => console.error("Maddy notification failed:", err.message));

      return res.status(200).json({ flagged: true, reason: result.flagReason });
    }

    /* ---- generate PDF ---- */
    const pdfBuffer = await generatePDF(client, weekNum, result.plan);

    /* ---- upload PDF to Supabase Storage ---- */
    const pdfPath = `clients/${client_id}/week_${weekNum}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("fitness-files")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("PDF upload failed:", uploadErr.message);
      return res.status(500).json({ error: "Failed to upload PDF" });
    }

    /* ---- get public URL ---- */
    const { data: urlData } = supabase.storage
      .from("fitness-files")
      .getPublicUrl(pdfPath);

    const pdfUrl = urlData ? urlData.publicUrl : null;

    if (!pdfUrl) {
      return res.status(500).json({ error: "Failed to get PDF URL" });
    }

    /* ---- send WhatsApp with PDF link and context note ---- */
    const focus = (result.plan && result.plan.notes) || "Personalized plan ready";
    const contextNote = `Week ${weekNum} plan ready! ${focus.slice(0, 100)}`;
    const now = new Date().toISOString();

    if (client.phone) {
      await sendText(
        client.phone,
        `${contextNote}\n\nDownload your plan: ${pdfUrl}`
      ).catch((err) => console.error("WhatsApp send failed:", err.message));
    }

    /* ---- insert into programs table ---- */
    const { error: programInsertErr } = await supabase.from("programs").insert({
      client_id,
      week_no: weekNum,
      generated_at: now,
      pdf_url: pdfUrl,
      whatsapp_sent_at: client.phone ? now : null,
      workout_plan: result.plan.workout_plan || null,
      nutrition_plan: result.plan.nutrition_plan || null,
      notes: contextNote,
    });

    if (programInsertErr) {
      console.error("Program insert failed:", programInsertErr.message);
    }

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    console.error("generate-program error:", maskPII(err.message));
    // Return 200 for internal callers and webhook-style resilience
    return res.status(200).json({ success: false, error: "Internal error" });
  }
};
