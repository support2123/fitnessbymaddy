const AISENSY_API = "https://backend.aisensy.com/campaign/t1/api/v2";

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "XXX..." + phone.slice(-3);
}

function detectMarket(phone) {
  if (!phone) return "GLOBAL";
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+91") || cleaned.startsWith("91")) return "IN";
  if (cleaned.startsWith("+971") || cleaned.startsWith("971")) return "UAE";
  if (cleaned.startsWith("+44") || cleaned.startsWith("44")) return "UK";
  return "GLOBAL";
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) {
    if (cleaned.length === 10) cleaned = "+91" + cleaned;
    else cleaned = "+" + cleaned;
  }
  return cleaned;
}

async function sendWhatsApp(phone, templateName, params = {}) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error("AISENSY_API_KEY not set");

  const body = {
    apiKey,
    campaignName: templateName,
    destination: normalizePhone(phone).replace("+", ""),
    userName: params.name || "there",
    templateParams: params.templateParams || [],
    media: params.media || {},
  };

  const res = await fetch(AISENSY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function sendFreeformWhatsApp(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error("AISENSY_API_KEY not set");

  const body = {
    apiKey,
    campaignName: "freeform_message",
    destination: normalizePhone(phone).replace("+", ""),
    message,
  };

  const res = await fetch(AISENSY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return { ok: res.ok, data: await res.json() };
}

module.exports = {
  maskPhone,
  detectMarket,
  normalizePhone,
  sendWhatsApp,
  sendFreeformWhatsApp,
};
