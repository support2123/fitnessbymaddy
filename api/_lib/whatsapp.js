const { maskPhone } = require("./helpers");

const API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";
const TWO_HOURS = 2 * 60 * 60 * 1000;

const lastMessageTime = new Map();

function canSend(phone, isClient) {
  if (isClient) return true;
  const last = lastMessageTime.get(phone);
  if (!last) return true;
  return Date.now() - last >= TWO_HOURS;
}

function recordSend(phone) {
  lastMessageTime.set(phone, Date.now());
}

async function sendTemplate(phone, templateName, params, { isClient = false } = {}) {
  if (!canSend(phone, isClient)) {
    return { skipped: true, reason: "rate_limited" };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: params,
    source: "automation",
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    recordSend(phone);
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp template send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendText(phone, text, { isClient = false } = {}) {
  if (!canSend(phone, isClient)) {
    return { skipped: true, reason: "rate_limited" };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: "text_message",
    destination: phone,
    userName: "FitnessByMaddy",
    message: { text },
    source: "automation",
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    recordSend(phone);
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`WhatsApp text send failed for ${maskPhone(phone)}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function notifyMaddy(message) {
  const phone = process.env.MADDY_PHONE;
  return sendText(phone, message, { isClient: true });
}

module.exports = { sendTemplate, sendText, notifyMaddy };
