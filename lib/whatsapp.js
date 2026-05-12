// lib/whatsapp.js  -  WhatsApp messaging via AiSensy API

const { supabase } = require("./supabase");
const { logMessage } = require("./supabase");

const AISENSY_API_URL = "https://backend.aisensy.com/campaign/t1/api/v2";
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;

if (!AISENSY_API_KEY) {
  console.warn("WARNING: AISENSY_API_KEY is not set");
}

// -------------------------------------------------------------------
// Rate-limit check
// Don't send if the last outbound message to this phone was < 2 hrs ago,
// UNLESS the recipient is an active client.
// -------------------------------------------------------------------
async function canSendMessage(phone) {
  // Check if this phone belongs to an active client
  const { data: activeClient } = await supabase
    .from("clients")
    .select("id")
    .eq("phone", phone)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  // Active clients are exempt from the rate limit
  if (activeClient) return true;

  // Check the most recent outbound message to this phone
  const { data: lastMsg } = await supabase
    .from("messages")
    .select("sent_at")
    .eq("phone", phone)
    .eq("direction", "out")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastMsg) return true;

  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  return new Date(lastMsg.sent_at).getTime() < twoHoursAgo;
}

// -------------------------------------------------------------------
// Send a WhatsApp template message via AiSensy
// -------------------------------------------------------------------
async function sendTemplate(phone, templateName, params = {}) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(
      `Rate-limited: skipping template "${templateName}" to ${maskPhone(phone)}`
    );
    return { rateLimited: true };
  }

  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone.replace(/^\+/, ""), // AiSensy expects digits only
    userName: params.name || "there",
    templateParams: params.templateParams || [],
    // Optional media
    ...(params.mediaUrl && { media: { url: params.mediaUrl, filename: params.mediaFilename || "file" } }),
  };

  const res = await fetch(AISENSY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  // Log the outbound message
  await logMessage(
    phone,
    "out",
    `[template] ${templateName} | params: ${JSON.stringify(params.templateParams || [])}`,
    templateName
  );

  return result;
}

// -------------------------------------------------------------------
// Send a plain text WhatsApp message via AiSensy
// -------------------------------------------------------------------
async function sendTextMessage(phone, text) {
  const allowed = await canSendMessage(phone);
  if (!allowed) {
    console.log(`Rate-limited: skipping text message to ${maskPhone(phone)}`);
    return { rateLimited: true };
  }

  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "text_message",
    destination: phone.replace(/^\+/, ""),
    userName: "FitnessByMaddy",
    templateParams: [text],
  };

  const res = await fetch(AISENSY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();

  // Log the outbound message
  await logMessage(phone, "out", text, null);

  return result;
}

// -------------------------------------------------------------------
// Mask phone for logging: "+91XXX...374"
// -------------------------------------------------------------------
function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone || "";
  const prefix = phone.slice(0, 3); // e.g. "+91"
  const suffix = phone.slice(-3);   // last 3 digits
  return `${prefix}XXX...${suffix}`;
}

// -------------------------------------------------------------------
// Detect market from phone country code
// -------------------------------------------------------------------
function detectMarket(phone) {
  if (!phone) return "GLOBAL";
  if (phone.startsWith("+91")) return "IN";
  if (phone.startsWith("+971")) return "UAE";
  if (phone.startsWith("+44")) return "UK";
  return "GLOBAL";
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  maskPhone,
  detectMarket,
  canSendMessage,
};
