const { getSupabase } = require("../lib/supabase");
const { sendText, detectMarket } = require("../lib/whatsapp");
const { checkMissedCheckins } = require("../lib/escalation");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from("clients")
      .select("*")
      .eq("status", "active");

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: "no_active_clients" });
    }

    let sent = 0;

    for (const client of clients) {
      const weekNo = getClientWeek(client);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from("checkins")
        .select("id")
        .eq("client_id", client.id)
        .eq("week_no", weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const isHinglish = market === "IN";

      let msg;
      if (isHinglish) {
        msg = `Hey ${client.name || "there"}! 📋 Week ${weekNo} check-in time!\n\n` +
          `Ye form fill karo (2 min lagega):\n${checkinUrl}\n\n` +
          `Weight, waist, photos aur energy level daal dena. Keep going! 💪`;
      } else {
        msg = `Hey ${client.name || "there"}! 📋 Time for your Week ${weekNo} check-in!\n\n` +
          `Fill out this quick form (2 mins):\n${checkinUrl}\n\n` +
          `Include your weight, waist, photos & energy level. You're doing great! 💪`;
      }

      await sendText(client.phone, msg);
      sent++;
    }

    await checkMissedCheckins(db);

    return res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error("Weekly checkin cron error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

function getClientWeek(client) {
  if (!client.program_started_at) return 0;
  const start = new Date(client.program_started_at);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}
