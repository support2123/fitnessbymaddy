const { getSupabase } = require("./supabase");

const AISENSY_BASE_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "XXX..." + phone.slice(-3);
}

async function logMessage(phone, direction, body, templateName) {
  try {
    const supabase = getSupabase();
    await supabase.from("messages").insert({
      phone,
      direction,
      body: body || null,
      template_name: templateName || null,
      sent_at: new Date().toISOString(),
      status: "sent",
    });
  } catch (err) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, err.message);
  }
}

async function sendTemplate(phone, templateName, params = {}) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || "",
    templateParams: params.templateParams || [],
    media: params.media || {},
  };

  try {
    const res = await fetch(AISENSY_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`AiSensy template failed for ${maskPhone(phone)}: ${res.status} ${text}`);
    }

    await logMessage(phone, "out", null, templateName);
    return res.ok;
  } catch (err) {
    console.error(`AiSensy template error for ${maskPhone(phone)}:`, err.message);
    return false;
  }
}

async function sendText(phone, message) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: "plain_text",
    destination: phone,
    userName: "",
    templateParams: [message],
  };

  try {
    const res = await fetch(AISENSY_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`AiSensy text failed for ${maskPhone(phone)}: ${res.status} ${text}`);
    }

    await logMessage(phone, "out", message, null);
    return res.ok;
  } catch (err) {
    console.error(`AiSensy text error for ${maskPhone(phone)}:`, err.message);
    return false;
  }
}

module.exports = { sendTemplate, sendText, maskPhone, logMessage };
