const { supabase } = require("./supabase");
const { maskPhone } = require("./utils");

const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Send a WhatsApp message via AiSensy API.
 * Includes rate limiting (2-hour window) unless the template is
 * an onboarding or check-in template.
 *
 * @param {string} phone   - Recipient phone number (E.164 format)
 * @param {string} templateName - AiSensy template name
 * @param {object} params  - Template parameters
 */
async function sendWhatsApp(phone, templateName, params = {}) {
  // ── Rate-limit check ──────────────────────────────────────────
  const bypassRateLimit =
    templateName.startsWith("onboard_") || templateName.startsWith("checkin_");

  if (!bypassRateLimit) {
    const twoHoursAgo = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

    const { data: recent } = await supabase
      .from("messages")
      .select("id")
      .eq("phone", phone)
      .eq("direction", "out")
      .gte("sent_at", twoHoursAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      console.log(
        `[whatsapp] Rate-limited: skipping ${templateName} to ${maskPhone(phone)}`
      );
      return { skipped: true, reason: "rate_limited" };
    }
  }

  // ── Send via AiSensy ──────────────────────────────────────────
  let status = "sent";
  try {
    const response = await fetch(AISENSY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: params.name || "there",
        templateParams: params.templateParams || [],
        ...params,
      }),
    });

    if (!response.ok) {
      status = "failed";
      const body = await response.text();
      console.error(
        `[whatsapp] Failed to send ${templateName} to ${maskPhone(phone)}: ${response.status} ${body}`
      );
    }
  } catch (err) {
    status = "failed";
    console.error(
      `[whatsapp] Error sending ${templateName} to ${maskPhone(phone)}: ${err.message}`
    );
  }

  // ── Log to messages table ─────────────────────────────────────
  const { error: logError } = await supabase.from("messages").insert({
    phone,
    direction: "out",
    body: templateName,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status,
  });

  if (logError) {
    console.error(
      `[whatsapp] Failed to log message for ${maskPhone(phone)}: ${logError.message}`
    );
  }

  return { skipped: false, status };
}

module.exports = { sendWhatsApp };
