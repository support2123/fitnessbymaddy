const { supabase } = require("./supabase");

const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

/**
 * Mask a phone number for logging: show first 3 and last 3 digits only.
 * e.g. "+917082478374" -> "+91***8374" (digits: 917082478374 -> 917***374)
 */
function maskPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return "***";
  return digits.slice(0, 3) + "***" + digits.slice(-3);
}

/**
 * Send a template message via AiSensy API.
 * @param {string} phone - Destination phone number
 * @param {string} templateName - Campaign / template name
 * @param {string[]} params - Template parameter values
 */
async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[whatsapp] Missing AISENSY_API_KEY — cannot send template to ${maskPhone(phone)}`);
    throw new Error("Missing AISENSY_API_KEY env var");
  }

  const payload = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: params,
  };

  try {
    const res = await fetch(AISENSY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[whatsapp] Template send failed for ${maskPhone(phone)}: ${res.status} ${text}`);
      throw new Error(`AiSensy API error: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error(`[whatsapp] Error sending template to ${maskPhone(phone)}: ${err.message}`);
    throw err;
  }
}

/**
 * Send a free-text message via AiSensy API.
 * @param {string} phone - Destination phone number
 * @param {string} message - Message body
 */
async function sendText(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error(`[whatsapp] Missing AISENSY_API_KEY — cannot send text to ${maskPhone(phone)}`);
    throw new Error("Missing AISENSY_API_KEY env var");
  }

  const payload = {
    apiKey,
    campaignName: "free_text",
    destination: phone,
    userName: "FitnessByMaddy",
    message,
  };

  try {
    const res = await fetch(AISENSY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[whatsapp] Text send failed for ${maskPhone(phone)}: ${res.status} ${text}`);
      throw new Error(`AiSensy API error: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error(`[whatsapp] Error sending text to ${maskPhone(phone)}: ${err.message}`);
    throw err;
  }
}

/**
 * Check if the last outbound message to this phone was less than 2 hours ago.
 * @param {string} phone - Phone number to check
 * @returns {Promise<boolean>} true if rate-limited (message sent < 2h ago)
 */
async function checkRateLimit(phone) {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .eq("phone", phone)
      .eq("direction", "outbound")
      .gte("created_at", twoHoursAgo)
      .limit(1);

    if (error) {
      console.error(`[whatsapp] Rate-limit check failed for ${maskPhone(phone)}: ${error.message}`);
      return false;
    }

    return data && data.length > 0;
  } catch (err) {
    console.error(`[whatsapp] Rate-limit check error for ${maskPhone(phone)}: ${err.message}`);
    return false;
  }
}

/**
 * Log a message to the messages table.
 * @param {string} phone - Phone number
 * @param {string} direction - 'inbound' or 'outbound'
 * @param {string} body - Message body
 * @param {string|null} templateName - Template name if applicable
 */
async function logMessage(phone, direction, body, templateName) {
  try {
    const { error } = await supabase.from("messages").insert({
      phone,
      direction,
      body,
      template_name: templateName || null,
    });

    if (error) {
      console.error(`[whatsapp] Failed to log message for ${maskPhone(phone)}: ${error.message}`);
    }
  } catch (err) {
    console.error(`[whatsapp] Error logging message for ${maskPhone(phone)}: ${err.message}`);
  }
}

module.exports = {
  sendTemplate,
  sendText,
  checkRateLimit,
  logMessage,
  maskPhone,
};
