// api/send-whatsapp.js  —  Internal helper for sending WhatsApp messages with rate limiting
const { logMessage, supabase } = require("../lib/supabase");
const { sendTemplate, sendTextMessage } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

/** Minimum interval between outbound messages per phone (ms) */
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const { phone, template, params, text, force } = body;

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------
    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    if (!template && !text) {
      return res.status(400).json({ error: "Either template or text is required" });
    }

    const masked = maskPhone(phone);

    // ------------------------------------------------------------------
    // Rate-limit check (skip when force=true for client messages)
    // ------------------------------------------------------------------
    if (!force) {
      const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

      const { data: recentMessages, error: queryErr } = await supabase
        .from("messages")
        .select("id, sent_at")
        .eq("phone", phone)
        .eq("direction", "out")
        .gte("sent_at", cutoff)
        .order("sent_at", { ascending: false })
        .limit(1);

      if (queryErr) throw queryErr;

      if (recentMessages && recentMessages.length > 0) {
        const lastSentAt = recentMessages[0].sent_at;
        console.log(`send-whatsapp: rate limited ${masked}, last outbound at ${lastSentAt}`);
        return res.status(429).json({
          error: "Rate limited",
          message: "Last outbound message was less than 2 hours ago",
          last_sent_at: lastSentAt,
        });
      }
    }

    // ------------------------------------------------------------------
    // Send via template or plain text
    // ------------------------------------------------------------------
    let result;
    let logBody;
    let logTemplateName = null;

    if (template) {
      console.log(`send-whatsapp: sending template "${template}" to ${masked}`);
      result = await sendTemplate(phone, template, params || {});
      logBody = `[template] ${template}`;
      logTemplateName = template;
    } else {
      console.log(`send-whatsapp: sending text to ${masked}`);
      result = await sendTextMessage(phone, text);
      logBody = text;
    }

    // If the library-level rate limiter kicked in, surface it
    if (result && result.rateLimited) {
      console.log(`send-whatsapp: library rate-limited send to ${masked}`);
      return res.status(429).json({
        error: "Rate limited",
        message: "Library-level rate limit applied",
      });
    }

    // ------------------------------------------------------------------
    // Log the outbound message
    // ------------------------------------------------------------------
    const logEntry = await logMessage(phone, "out", logBody, logTemplateName);

    console.log(`send-whatsapp: message sent to ${masked}, logged id=${logEntry.id}`);

    return res.status(200).json({
      success: true,
      message_id: logEntry.id,
    });
  } catch (err) {
    console.error("send-whatsapp: error:", err.message);
    return res.status(500).json({ error: "Failed to send message" });
  }
};
