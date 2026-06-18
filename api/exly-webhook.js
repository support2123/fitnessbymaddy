// api/exly-webhook.js  —  Handles Exly purchase webhook notifications
const { getLeadByPhone, upsertLead, logMessage, supabase } = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

/** Map program slug to duration in days */
const PROGRAM_DURATIONS = {
  "6wk_gym":  42,
  "6wk_home": 42,
  "6wk":      42,
  "12wk":     84,
  pcos:       56,
  "40plus":   56,
  zoom_trial:  7,
  zoom_pack:  30,
  shred:      28,
  vip:        84,
  custom:     90,
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ------------------------------------------------------------------
    // Verify webhook secret if configured
    // ------------------------------------------------------------------
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret =
        req.headers["x-exly-secret"] ||
        req.headers["x-webhook-secret"] ||
        "";
      if (headerSecret !== secret) {
        console.warn("exly-webhook: invalid webhook secret");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    // ------------------------------------------------------------------
    // Extract fields from webhook payload
    // ------------------------------------------------------------------
    const body = req.body || {};
    const {
      phone,
      name,
      email,
      checkout_id,
      amount,
      program: programRaw,
    } = body;

    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    const program = (programRaw || "custom").toLowerCase().replace(/\s+/g, "_");
    const masked = maskPhone(phone);
    console.log(`exly-webhook: purchase from ${masked}, program=${program}, amount=${amount}`);

    // ------------------------------------------------------------------
    // Find or create the lead, then mark as converted
    // ------------------------------------------------------------------
    let lead = await getLeadByPhone(phone);
    if (!lead) {
      lead = await upsertLead({
        phone,
        name: name || null,
        status: "converted",
        source: "exly",
      });
    } else {
      await supabase
        .from("leads")
        .update({ status: "converted" })
        .eq("id", lead.id);
    }

    // ------------------------------------------------------------------
    // Calculate program dates
    // ------------------------------------------------------------------
    const durationDays = PROGRAM_DURATIONS[program] || 90;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);

    // ------------------------------------------------------------------
    // Storage folder path (actual folder created on first upload)
    // ------------------------------------------------------------------
    const storagePath = `clients/${phone.replace(/\D/g, "")}`;

    // ------------------------------------------------------------------
    // Insert into clients table
    // ------------------------------------------------------------------
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .insert({
        phone,
        name: name || (lead && lead.name) || null,
        email: email || null,
        lead_id: lead.id,
        checkout_id: checkout_id || null,
        paid_amount: amount ? parseInt(amount, 10) : null,
        program,
        status: "active",
        folder_url: storagePath,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
      })
      .select()
      .single();

    if (clientErr) throw clientErr;

    console.log(`exly-webhook: client created id=${client.id} for ${masked}`);

    // ------------------------------------------------------------------
    // Send onboarding WhatsApp template
    // ------------------------------------------------------------------
    const templateName = `onboard_${program}`;
    try {
      await sendTemplate(phone, templateName, {
        name: name || "there",
        templateParams: [name || "there"],
      });
      console.log(`exly-webhook: onboarding template sent to ${masked}`);
    } catch (err) {
      console.error(`exly-webhook: failed to send onboarding template to ${masked}:`, err.message);
    }

    // ------------------------------------------------------------------
    // Log the conversion event
    // ------------------------------------------------------------------
    await logMessage(phone, "out", `Onboarding: ${templateName}`, templateName);

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error("exly-webhook: error:", err.message);
    // Return 200 for webhook reliability — Exly will retry on non-2xx
    return res.status(200).json({ ok: true, error: "internal" });
  }
};
