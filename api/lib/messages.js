const { getSupabase } = require("./supabase");

async function logMessage(phone, direction, body, templateName) {
  const db = getSupabase();
  const { error } = await db.from("messages").insert({
    phone,
    direction,
    body: body ? body.slice(0, 2000) : null,
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: "sent",
  });
  if (error) console.error("[MSG LOG]", error.message);
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

  const isClient = await db
    .from("clients")
    .select("id")
    .eq("phone", phone)
    .eq("status", "active")
    .limit(1);

  if (isClient.data && isClient.data.length > 0) return true;
  return !data || data.length === 0;
}

module.exports = { logMessage, canSendMessage };
