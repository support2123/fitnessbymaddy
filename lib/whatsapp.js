const { getSupabase } = require("./supabase");

const AISENSY_BASE = "https://backend.aisensy.com";

async function sendTemplate(phone, templateName, params = [], mediaUrl) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: params,
    source: "automation",
  };
  if (mediaUrl) {
    body.media = { url: mediaUrl, filename: "program.pdf" };
  }

  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  await logMessage(phone, "out", `[template: ${templateName}]`, templateName);
  return data;
}

async function sendSession(phone, text) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: "session_message",
    destination: phone,
    userName: "FitnessByMaddy",
    message: text,
    source: "automation",
  };

  const res = await fetch(`${AISENSY_BASE}/direct/t1/api/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  await logMessage(phone, "out", text, null);
  return data;
}

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  await db.from("messages").insert({
    phone,
    direction,
    body,
    template_name: templateName,
    status: "sent",
  });
}

async function canSendMessage(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data } = await db
    .from("messages")
    .select("id")
    .eq("phone", phone)
    .eq("direction", "out")
    .gte("sent_at", twoHoursAgo);

  const { data: client } = await db
    .from("clients")
    .select("id")
    .eq("phone", phone)
    .eq("status", "active")
    .maybeSingle();

  if (client) return true;
  return !data || data.length === 0;
}

module.exports = { sendTemplate, sendSession, logMessage, canSendMessage };
