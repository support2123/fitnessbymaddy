const { getSupabase } = require("./supabase");

const AISENSY_BASE = "https://backend.aisensy.com/campaign/t1/api/v2";

async function sendWhatsApp(phone, templateName, bodyValues, mediaUrl) {
  const rateLimited = await checkRateLimit(phone);
  if (rateLimited) {
    console.log(`Rate limited: ${maskPhone(phone)}`);
    return { ok: false, reason: "rate_limited" };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: bodyValues || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = "program.pdf";
  }

  const res = await fetch(AISENSY_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  const db = getSupabase();
  await db.from("messages").insert({
    phone,
    direction: "out",
    body: `[template: ${templateName}] ${(bodyValues || []).join(", ")}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? "sent" : "failed",
  });

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const db = getSupabase();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("direction", "out")
    .gte("sent_at", twoHoursAgo);
  return count >= 1;
}

async function sendWhatsAppForced(phone, templateName, bodyValues, mediaUrl) {
  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: "FitnessByMaddy",
    templateParams: bodyValues || [],
  };
  if (mediaUrl) {
    payload.mediaUrl = mediaUrl;
    payload.mediaFilename = "program.pdf";
  }

  const res = await fetch(AISENSY_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  const db = getSupabase();
  await db.from("messages").insert({
    phone,
    direction: "out",
    body: `[template: ${templateName}] ${(bodyValues || []).join(", ")}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? "sent" : "failed",
  });

  return { ok: res.ok, data };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 4) + "XXX..." + phone.slice(-3);
}

module.exports = { sendWhatsApp, sendWhatsAppForced, maskPhone };
