const { getSupabase } = require("./supabase");

const AISENSY_ENDPOINT = "https://backend.aisensy.com/campaign/t1/api/v2";

/**
 * Mask a phone number for safe logging — only last 3 digits visible.
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  const str = String(phone);
  if (str.length <= 3) return "***";
  return "*".repeat(str.length - 3) + str.slice(-3);
}

/**
 * Check whether a lead has opted out (status = 'dropped').
 * @param {string} phone
 * @returns {Promise<boolean>}
 */
async function isOptedOut(phone) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("leads")
    .select("status")
    .eq("phone", phone)
    .eq("status", "dropped")
    .maybeSingle();

  if (error) {
    console.error(
      `[whatsapp] Error checking opt-out for ${maskPhone(phone)}:`,
      error.message
    );
    return false; // fail-open so we don't silently block messages
  }

  return !!data;
}

/**
 * Log an outbound message to the messages table.
 * @param {object} record
 */
async function logMessage(record) {
  const supabase = getSupabase();
  const { error } = await supabase.from("messages").insert(record);

  if (error) {
    console.error(
      `[whatsapp] Failed to log message for ${maskPhone(record.phone)}:`,
      error.message
    );
  }
}

/**
 * Send a WhatsApp template message via AiSensy.
 * @param {string} phone       - Recipient phone number with country code
 * @param {string} templateName - AiSensy campaign / template name
 * @param {string[]} params    - Template parameter values
 * @returns {Promise<object>}  - AiSensy API response body
 */
async function sendWhatsApp(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error("Missing AISENSY_API_KEY env var");

  // Opt-out guard
  if (await isOptedOut(phone)) {
    console.log(
      `[whatsapp] Skipping template message to opted-out number ${maskPhone(phone)}`
    );
    return { skipped: true, reason: "opted_out" };
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: params,
  };

  try {
    const res = await fetch(AISENSY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    await logMessage({
      phone,
      direction: "out",
      body: JSON.stringify(params),
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: res.ok ? "sent" : "failed",
    });

    return data;
  } catch (err) {
    console.error(
      `[whatsapp] Template send failed for ${maskPhone(phone)}:`,
      err.message
    );
    await logMessage({
      phone,
      direction: "out",
      body: JSON.stringify(params),
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: "failed",
    });
    throw err;
  }
}

/**
 * Send a free-form text message via AiSensy.
 * @param {string} phone - Recipient phone number with country code
 * @param {string} text  - Message body
 * @returns {Promise<object>} - AiSensy API response body
 */
async function sendTextMessage(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error("Missing AISENSY_API_KEY env var");

  // Opt-out guard
  if (await isOptedOut(phone)) {
    console.log(
      `[whatsapp] Skipping text message to opted-out number ${maskPhone(phone)}`
    );
    return { skipped: true, reason: "opted_out" };
  }

  const body = {
    apiKey,
    campaignName: "text_message",
    destination: phone,
    userName: "FitnessByMaddy",
    message: { type: "text", text },
  };

  try {
    const res = await fetch(AISENSY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    await logMessage({
      phone,
      direction: "out",
      body: text,
      sent_at: new Date().toISOString(),
      status: res.ok ? "sent" : "failed",
    });

    return data;
  } catch (err) {
    console.error(
      `[whatsapp] Text send failed for ${maskPhone(phone)}:`,
      err.message
    );
    await logMessage({
      phone,
      direction: "out",
      body: text,
      sent_at: new Date().toISOString(),
      status: "failed",
    });
    throw err;
  }
}

module.exports = { sendWhatsApp, sendTextMessage };
