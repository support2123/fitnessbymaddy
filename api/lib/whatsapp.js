const { getSupabase } = require("./supabase");

const AISENSY_API = "https://backend.aisensy.com/campaign/t1/api/v2";

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "XXX..." + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith("+91") || phone.startsWith("91")) return "IN";
  if (phone.startsWith("+971") || phone.startsWith("971")) return "UAE";
  if (phone.startsWith("+44") || phone.startsWith("44")) return "UK";
  return "GLOBAL";
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from("messages")
    .select("id")
    .eq("phone", phone)
    .eq("direction", "out")
    .gte("sent_at", twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

async function sendTemplate(phone, templateName, params = []) {
  const db = getSupabase();

  const { data: lead } = await db
    .from("leads")
    .select("status")
    .eq("phone", phone)
    .single();

  if (lead && lead.status === "dropped") {
    console.log(`Blocked: ${maskPhone(phone)} is dropped`);
    return { blocked: true, reason: "dropped" };
  }

  const isClient = await isActiveClient(phone);

  if (!isClient) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { blocked: true, reason: "rate_limited" };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace("+", ""),
    userName: "FitnessByMaddy",
    templateParams: params,
  };

  const res = await fetch(AISENSY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  await db.from("messages").insert({
    phone,
    direction: "out",
    body: `Template: ${templateName}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? "sent" : "failed",
  });

  return result;
}

async function sendText(phone, text) {
  const db = getSupabase();

  const isClient = await isActiveClient(phone);
  if (!isClient) {
    const allowed = await canSendMessage(phone);
    if (!allowed) {
      return { blocked: true, reason: "rate_limited" };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: "text_message",
    destination: phone.replace("+", ""),
    userName: "FitnessByMaddy",
    message: { type: "text", text },
  };

  const res = await fetch(AISENSY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await db.from("messages").insert({
    phone,
    direction: "out",
    body: text,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: res.ok ? "sent" : "failed",
  });

  return res.json();
}

async function isActiveClient(phone) {
  const db = getSupabase();
  const { data } = await db
    .from("clients")
    .select("id")
    .eq("phone", phone)
    .eq("status", "active")
    .limit(1);
  return data && data.length > 0;
}

async function notifyMaddy(subject, details) {
  const maddyPhone = "+917082478374";
  const msg = `⚠️ ESCALATION: ${subject}\n${details}`;
  await sendText(maddyPhone, msg);
}

module.exports = {
  maskPhone,
  detectMarket,
  canSendMessage,
  sendTemplate,
  sendText,
  isActiveClient,
  notifyMaddy,
};
