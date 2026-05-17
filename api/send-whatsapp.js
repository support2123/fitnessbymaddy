const { getSupabase } = require("./_lib/supabase");
const { sendWhatsApp, sendTextMessage } = require("./_lib/whatsapp");

/**
 * POST /api/send-whatsapp
 *
 * Internal helper API for sending WhatsApp messages with rate limiting.
 * Active clients bypass the rate limit; non-opted-in numbers are limited
 * to 1 message per 2-hour window.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Verify internal caller via bearer token ─────────────────────────
  const authHeader = req.headers.authorization || "";
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error("[send-whatsapp] Missing INTERNAL_API_KEY env var");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  if (authHeader !== `Bearer ${expectedKey}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { phone, template_name, params, text_message } = req.body || {};

  if (!phone) {
    return res.status(400).json({ error: "Missing required field: phone" });
  }

  if (!template_name && !text_message) {
    return res
      .status(400)
      .json({ error: "Provide either template_name or text_message" });
  }

  const supabase = getSupabase();

  try {
    // ── Rate limiting check ───────────────────────────────────────────
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { count: recentCount, error: countErr } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("sent_at", twoHoursAgo);

    if (countErr) {
      console.error(
        "[send-whatsapp] Error counting recent messages:",
        countErr.message
      );
      // Fail-open: proceed with the send
    }

    if (recentCount >= 1) {
      // Check whether the phone belongs to an active client (bypass rate limit)
      const { data: activeClient, error: clientErr } = await supabase
        .from("clients")
        .select("id")
        .eq("phone", phone)
        .eq("status", "active")
        .maybeSingle();

      if (clientErr) {
        console.error(
          "[send-whatsapp] Error checking client status:",
          clientErr.message
        );
      }

      if (!activeClient) {
        console.log(
          `[send-whatsapp] Rate limited non-client phone (${recentCount} msgs in 2h window)`
        );
        return res.status(429).json({ error: "rate_limited" });
      }
    }

    // ── Send the message ──────────────────────────────────────────────
    let result;

    if (template_name) {
      result = await sendWhatsApp(phone, template_name, params || []);
      console.log(
        `[send-whatsapp] Template "${template_name}" sent to ${phone}`
      );
    } else {
      result = await sendTextMessage(phone, text_message);
      console.log(`[send-whatsapp] Text message sent to ${phone}`);
    }

    return res.status(200).json({
      status: "sent",
      message_id: result.message_id || result.id || null,
    });
  } catch (err) {
    console.error("[send-whatsapp] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
