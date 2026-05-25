const { getSupabase } = require("./supabase");

const AISENSY_ENDPOINT = "https://backend.aisensy.com/campaign/t1/api/v2";
const RATE_LIMIT_HOURS = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a phone number for safe logging.
 * "+917082478374" → "+91XXX...374"
 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return "***";

  // Find where the country code ends (after the '+' and 1-3 digit country code)
  // We'll keep the country code prefix, mask the next 3 digits, show last 3
  const match = phone.match(/^(\+\d{1,3})/);
  if (!match) return "***";

  const countryCode = match[1];
  const last3 = phone.slice(-3);

  return `${countryCode}XXX...${last3}`;
}

/**
 * Check whether a phone number belongs to an existing client.
 */
async function isClient(phone) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("phone", phone)
    .eq("status", "active")
    .limit(1);

  if (error) {
    console.error("[whatsapp] Client check failed:", error.message);
    return false;
  }

  return data && data.length > 0;
}

/**
 * Enforce rate limiting for non-client phones.
 * Returns true if the message should be blocked.
 */
async function isRateLimited(phone) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("phone", phone)
    .eq("direction", "out")
    .gte("created_at", cutoff)
    .limit(1);

  if (error) {
    console.error("[whatsapp] Rate-limit check failed:", error.message);
    return false; // fail-open
  }

  return data && data.length > 0;
}

/**
 * Log an outbound message to the messages table.
 */
async function logMessage(phone, content, templateName) {
  const supabase = getSupabase();

  const { error } = await supabase.from("messages").insert({
    phone,
    direction: "out",
    body: typeof content === "string" ? content : JSON.stringify(content),
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[whatsapp] Failed to log message:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a WhatsApp template message via AiSensy.
 *
 * @param {string}   phone         E.164 phone number
 * @param {string}   templateName  AiSensy campaign / template name
 * @param {string[]} params        Template parameter values
 * @returns {Promise<object>}      AiSensy API response body
 */
async function sendWhatsApp(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required env var: AISENSY_API_KEY");
  }

  // Rate-limit check (skip for clients)
  const clientFlag = await isClient(phone);
  if (!clientFlag) {
    const limited = await isRateLimited(phone);
    if (limited) {
      console.log(
        `[whatsapp] Rate-limited: skipping message to ${maskPhone(phone)}`
      );
      return { skipped: true, reason: "rate_limited" };
    }
  }

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: params || [],
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

    if (!res.ok) {
      console.error(
        `[whatsapp] AiSensy error for ${maskPhone(phone)}:`,
        data
      );
      throw new Error(
        `AiSensy API returned ${res.status}: ${JSON.stringify(data)}`
      );
    }

    console.log(`[whatsapp] Template "${templateName}" sent to ${maskPhone(phone)}`);

    // Log to messages table
    await logMessage(phone, JSON.stringify({ params }), templateName);

    return data;
  } catch (err) {
    console.error(
      `[whatsapp] Failed to send template to ${maskPhone(phone)}:`,
      err.message
    );
    throw err;
  }
}

/**
 * Send a free-form text WhatsApp message via AiSensy.
 *
 * @param {string} phone  E.164 phone number
 * @param {string} text   Message text
 * @returns {Promise<object>}
 */
async function sendWhatsAppText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required env var: AISENSY_API_KEY");
  }

  // Rate-limit check (skip for clients)
  const clientFlag = await isClient(phone);
  if (!clientFlag) {
    const limited = await isRateLimited(phone);
    if (limited) {
      console.log(
        `[whatsapp] Rate-limited: skipping text to ${maskPhone(phone)}`
      );
      return { skipped: true, reason: "rate_limited" };
    }
  }

  const body = {
    apiKey,
    campaignName: "text_message",
    destination: phone,
    userName: "FitnessByMaddy",
    message: text,
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

    if (!res.ok) {
      console.error(
        `[whatsapp] AiSensy text error for ${maskPhone(phone)}:`,
        data
      );
      throw new Error(
        `AiSensy API returned ${res.status}: ${JSON.stringify(data)}`
      );
    }

    console.log(`[whatsapp] Text sent to ${maskPhone(phone)}`);

    // Log to messages table
    await logMessage(phone, text, null);

    return data;
  } catch (err) {
    console.error(
      `[whatsapp] Failed to send text to ${maskPhone(phone)}:`,
      err.message
    );
    throw err;
  }
}

module.exports = { sendWhatsApp, sendWhatsAppText, maskPhone };
