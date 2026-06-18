// api/checkin-submit.js — Weekly check-in form submission handler
// POST /api/checkin-submit

const { supabase, getClient, logMessage } = require("../lib/supabase");
const { sendTextMessage } = require("../lib/whatsapp");
const { shouldEscalate, maskPhone } = require("../lib/utils");

const MADDY_PHONE = "+917082478374";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── Parse body (JSON or form-data parsed by Vercel) ────────────
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos, // array of up to 3 URLs
    } = req.body || {};

    // ── Input validation ───────────────────────────────────────────
    if (!client_id || week_no == null) {
      return res
        .status(400)
        .json({ error: "client_id and week_no are required" });
    }

    const weekNum = parseInt(week_no, 10);
    if (isNaN(weekNum) || weekNum < 1) {
      return res
        .status(400)
        .json({ error: "week_no must be a positive integer" });
    }

    const compScore =
      compliance_score != null ? parseInt(compliance_score, 10) : null;
    if (compScore != null && (compScore < 1 || compScore > 10)) {
      return res
        .status(400)
        .json({ error: "compliance_score must be between 1 and 10" });
    }

    const energyVal = energy != null ? parseInt(energy, 10) : null;
    if (energyVal != null && (energyVal < 1 || energyVal > 10)) {
      return res
        .status(400)
        .json({ error: "energy must be between 1 and 10" });
    }

    // Validate photos array — max 3 URLs
    let photosUrls = [];
    if (photos) {
      photosUrls = Array.isArray(photos) ? photos : [photos];
      photosUrls = photosUrls
        .filter((u) => typeof u === "string" && u.startsWith("http"))
        .slice(0, 3);
    }

    // ── Validate client exists and is active ───────────────────────
    let client;
    try {
      client = await getClient(client_id);
    } catch {
      return res.status(404).json({ error: "Client not found" });
    }
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    if (client.status !== "active") {
      return res.status(400).json({ error: "Client is not active" });
    }

    console.log(
      `[checkin-submit] Client ${maskPhone(client.phone)} submitting week ${weekNum}`
    );

    // ── Insert checkin ─────────────────────────────────────────────
    const { data: checkin, error: insertErr } = await supabase
      .from("checkins")
      .insert({
        client_id,
        week_no: weekNum,
        weight: weight != null ? parseFloat(weight) : null,
        waist: waist != null ? parseFloat(waist) : null,
        compliance_score: compScore,
        energy: energyVal,
        issues: issues || null,
        photos_urls: photosUrls,
        form_submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      // Unique constraint violation → already submitted
      if (insertErr.code === "23505") {
        return res.status(409).json({
          error: `Check-in for week ${weekNum} already submitted`,
        });
      }
      throw insertErr;
    }

    // ── Escalation checks ──────────────────────────────────────────
    let escalated = false;
    const escalationReasons = [];

    // 1. Issues text contains escalation keywords
    if (shouldEscalate(issues)) {
      escalationReasons.push("escalation_keyword_detected");
    }

    // 2. Two consecutive weeks with compliance_score <= 3
    if (compScore != null && compScore <= 3 && weekNum >= 2) {
      const { data: prevCheckin } = await supabase
        .from("checkins")
        .select("compliance_score")
        .eq("client_id", client_id)
        .eq("week_no", weekNum - 1)
        .maybeSingle();

      if (
        prevCheckin &&
        prevCheckin.compliance_score != null &&
        prevCheckin.compliance_score <= 3
      ) {
        escalationReasons.push("low_compliance_2_consecutive_weeks");
      }
    }

    // ── Notify Maddy if escalation needed ──────────────────────────
    if (escalationReasons.length > 0) {
      escalated = true;
      const alertMsg =
        `ALERT: Client ${client.name || maskPhone(client.phone)} ` +
        `(Week ${weekNum}) needs attention.\n` +
        `Reasons: ${escalationReasons.join(", ")}\n` +
        `Compliance: ${compScore ?? "N/A"}, Energy: ${energyVal ?? "N/A"}\n` +
        `Issues: ${issues || "none"}`;

      try {
        await sendTextMessage(MADDY_PHONE, alertMsg);
        await logMessage(MADDY_PHONE, "out", alertMsg, null);
        console.log(
          `[checkin-submit] Escalation sent for ${maskPhone(client.phone)}: ${escalationReasons.join(", ")}`
        );
      } catch (notifyErr) {
        console.error(
          "[checkin-submit] Escalation notification failed:",
          notifyErr.message
        );
      }
    }

    return res.status(200).json({
      success: true,
      checkin_id: checkin.id,
      escalated,
    });
  } catch (err) {
    console.error("[checkin-submit] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
