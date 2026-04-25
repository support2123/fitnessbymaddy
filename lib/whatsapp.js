const { getSupabase } = require("./supabase");

const AISENSY_BASE_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

function maskPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return "***";
  return digits.slice(0, 3) + "*".repeat(digits.length - 6) + digits.slice(-3);
}

async function logMessage(phone, body, templateName, status) {
  try {
    const supabase = getSupabase();
    await supabase.from("messages").insert({
      phone,
      direction: "out",
      body: body || null,
      template_name: templateName || null,
      sent_at: new Date().toISOString(),
      status,
    });
  } catch (err) {
    console.error(`Failed to log message for ${maskPhone(phone)}:`, err.message);
  }
}

async function sendTemplate(phone, templateName, params) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error("Missing AISENSY_API_KEY");

  try {
    const res = await fetch(AISENSY_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": apiKey,
      },
      body: JSON.stringify({
        apiKey,
        campaignName: templateName,
        destination: phone.replace(/^\+/, ""),
        userName: (params && params.name) || "there",
        templateParams: params ? Object.values(params).map(String) : [],
      }),
    });

    const data = await res.json();
    const status = res.ok ? "sent" : "failed";
    await logMessage(phone, null, templateName, status);
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`sendTemplate failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, null, templateName, "error");
    throw err;
  }
}

async function sendText(phone, message) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error("Missing AISENSY_API_KEY");

  try {
    const res = await fetch(AISENSY_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AiSensy-Project-API-Pwd": apiKey,
      },
      body: JSON.stringify({
        apiKey,
        campaignName: "text_message",
        destination: phone.replace(/^\+/, ""),
        message,
      }),
    });

    const data = await res.json();
    const status = res.ok ? "sent" : "failed";
    await logMessage(phone, message, null, status);
    return { ok: res.ok, data };
  } catch (err) {
    console.error(`sendText failed for ${maskPhone(phone)}:`, err.message);
    await logMessage(phone, message, null, "error");
    throw err;
  }
}

async function checkRateLimit(phone) {
  const supabase = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("direction", "out")
    .gte("sent_at", twoHoursAgo);

  if (error) {
    console.error(`Rate limit check failed for ${maskPhone(phone)}:`, error.message);
    return false;
  }

  return count === 0;
}

module.exports = { sendTemplate, sendText, checkRateLimit };
