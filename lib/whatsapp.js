const supabase = require("./supabase");
const { maskPhone } = require("./helpers");

const AISENSY_URL = "https://backend.aisensy.com/campaign/t1/api/v2";
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

async function isRateLimited(phone) {
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("phone", phone)
    .eq("status", "active")
    .maybeSingle();

  if (client) return false;

  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data: recent } = await supabase
    .from("messages")
    .select("id")
    .eq("phone", phone)
    .eq("direction", "out")
    .gte("sent_at", cutoff)
    .limit(1);

  return recent && recent.length > 0;
}

async function logMessage(phone, { direction, body, templateName, status }) {
  await supabase.from("messages").insert({
    phone,
    direction,
    body: body || null,
    template_name: templateName || null,
    status,
  });
}

async function sendTemplate(phone, templateName, params) {
  if (await isRateLimited(phone)) {
    console.log(
      `Rate limited: ${maskPhone(phone)}, skipping template ${templateName}`
    );
    return { success: false, reason: "rate_limited" };
  }

  try {
    const res = await fetch(AISENSY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Key": process.env.AISENSY_API_KEY,
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: templateName,
        destination: phone,
        userName: "FitnessByMaddy",
        templateParams: params || [],
      }),
    });

    const data = await res.json();
    const status = res.ok ? "sent" : "failed";

    await logMessage(phone, {
      direction: "out",
      templateName,
      body: JSON.stringify(params),
      status,
    });

    return { success: res.ok, data };
  } catch (err) {
    console.error(
      `sendTemplate failed for ${maskPhone(phone)}:`,
      err.message
    );
    await logMessage(phone, {
      direction: "out",
      templateName,
      status: "error",
    });
    return { success: false, error: err.message };
  }
}

async function sendText(phone, text) {
  if (await isRateLimited(phone)) {
    console.log(`Rate limited: ${maskPhone(phone)}, skipping text`);
    return { success: false, reason: "rate_limited" };
  }

  try {
    const res = await fetch(AISENSY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Key": process.env.AISENSY_API_KEY,
      },
      body: JSON.stringify({
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: "text_message",
        destination: phone,
        userName: "FitnessByMaddy",
        message: text,
      }),
    });

    const data = await res.json();
    const status = res.ok ? "sent" : "failed";

    await logMessage(phone, {
      direction: "out",
      body: text,
      status,
    });

    return { success: res.ok, data };
  } catch (err) {
    console.error(`sendText failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, {
      direction: "out",
      body: text,
      status: "error",
    });
    return { success: false, error: err.message };
  }
}

module.exports = { sendTemplate, sendText };
