const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;
const lastSentMap = new Map();
const optedInPhones = new Set();

function markOptedIn(phone) {
  optedInPhones.add(phone);
}

function checkRateLimit(phone) {
  if (optedInPhones.has(phone)) return;

  const lastSent = lastSentMap.get(phone);
  if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
    const minutesLeft = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastSent)) / 60000);
    throw new Error(`Rate limited: ${maskPhone(phone)} must wait ${minutesLeft}m before next message`);
  }
}

function recordSent(phone) {
  lastSentMap.set(phone, Date.now());
}

async function sendTemplate(phone, templateName, params) {
  checkRateLimit(phone);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: "FitnessByMaddy",
      templateParams: params,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AiSensy sendTemplate failed (${res.status}): ${body}`);
  }

  recordSent(phone);
  return res.json();
}

async function sendText(phone, message) {
  checkRateLimit(phone);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: AISENSY_API_KEY,
      campaignName: "text_message",
      destination: phone,
      userName: "FitnessByMaddy",
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AiSensy sendText failed (${res.status}): ${body}`);
  }

  recordSent(phone);
  return res.json();
}

function maskPhone(phone) {
  const cleaned = phone.replace(/[^+\d]/g, "");

  if (cleaned.startsWith("+") && cleaned.length >= 8) {
    const ccLen = cleaned.startsWith("+971") ? 4
      : cleaned.startsWith("+91") ? 3
      : cleaned.startsWith("+44") ? 3
      : 3;
    const countryCode = cleaned.slice(0, ccLen);
    const rest = cleaned.slice(ccLen);
    const firstDigit = rest[0] || "";
    const lastThree = cleaned.slice(-3);
    return `${countryCode}${firstDigit}XXX...${lastThree}`;
  }

  if (cleaned.length >= 6) {
    return `${cleaned.slice(0, 3)}XXX...${cleaned.slice(-3)}`;
  }

  return "XXX...";
}

export { sendTemplate, sendText, maskPhone, markOptedIn };
