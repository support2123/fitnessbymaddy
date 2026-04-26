const { supabase } = require("./supabase");
const { maskPhone } = require("./utils");

const AISENSY_BASE = "https://backend.aisensy.com/campaign/t1/api/v2";
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

// In-memory rate limit tracker (per serverless instance).
// Acceptable for burst protection; Supabase messages table is the durable record.
const lastSendByPhone = new Map();

function isRateLimited(phone) {
  const last = lastSendByPhone.get(phone);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_MS;
}

function recordSend(phone) {
  lastSendByPhone.set(phone, Date.now());
}

async function logMessage(phone, direction, templateName, body, status) {
  try {
    await supabase.from("messages").insert({
      phone,
      direction,
      template_name: templateName,
      body: typeof body === "string" ? body : JSON.stringify(body),
      status,
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      `Failed to log message for ${maskPhone(phone)}:`,
      err.message
    );
  }
}

async function sendTemplate(phone, templateName, params) {
  if (isRateLimited(phone)) {
    console.warn(
      `Rate limited: skipping template "${templateName}" to ${maskPhone(phone)}`
    );
    return { success: false, reason: "rate_limited" };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: templateName,
    templateParams: params || [],
  };

  try {
    const res = await fetch(`${AISENSY_BASE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(
        `AiSensy template error for ${maskPhone(phone)}:`,
        data.message || res.statusText
      );
      await logMessage(phone, "out", templateName, templateName, "failed");
      return { success: false, reason: data.message || res.statusText };
    }

    recordSend(phone);
    await logMessage(phone, "out", templateName, templateName, "sent");
    return { success: true, data };
  } catch (err) {
    console.error(
      `AiSensy request failed for ${maskPhone(phone)}:`,
      err.message
    );
    await logMessage(phone, "out", templateName, templateName, "error");
    return { success: false, reason: err.message };
  }
}

async function sendText(phone, body) {
  if (isRateLimited(phone)) {
    console.warn(
      `Rate limited: skipping text to ${maskPhone(phone)}`
    );
    return { success: false, reason: "rate_limited" };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: "text_message",
    destination: phone,
    userName: "text_message",
    message: body,
  };

  try {
    const res = await fetch(`${AISENSY_BASE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(
        `AiSensy text error for ${maskPhone(phone)}:`,
        data.message || res.statusText
      );
      await logMessage(phone, "out", null, body, "failed");
      return { success: false, reason: data.message || res.statusText };
    }

    recordSend(phone);
    await logMessage(phone, "out", null, body, "sent");
    return { success: true, data };
  } catch (err) {
    console.error(
      `AiSensy request failed for ${maskPhone(phone)}:`,
      err.message
    );
    await logMessage(phone, "out", null, body, "error");
    return { success: false, reason: err.message };
  }
}

module.exports = { sendTemplate, sendText };
