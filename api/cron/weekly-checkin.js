const { getSupabase } = require("../../lib/supabase");
const { sendWhatsAppForced, maskPhone } = require("../../lib/whatsapp");
const { detectMarket, isHinglish } = require("../../lib/market");
const { escalateToMaddy } = require("../../lib/escalation");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const { data: clients } = await db
      .from("clients")
      .select("id, phone, name, program, program_started_at")
      .eq("status", "active");

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: "No active clients", sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from("checkins")
        .select("id")
        .eq("client_id", client.id)
        .eq("week_no", weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await db
        .from("checkins")
        .select("*", { count: "exact", head: true })
        .eq("client_id", client.id)
        .gte("week_no", weekNo - 2)
        .lte("week_no", weekNo - 1);

      const expectedRecent = Math.min(weekNo - 1, 2);
      if (expectedRecent >= 2 && (!missedCount || missedCount === 0)) {
        await escalateToMaddy(
          "2_consecutive_missed_checkins",
          client.phone,
          `Client ${client.name || maskPhone(client.phone)} missed 2+ check-ins`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const template = isHinglish(market) ? "weekly_checkin_hi" : "weekly_checkin";

      await sendWhatsAppForced(client.phone, template, [
        client.name || "there",
        String(weekNo),
        checkinUrl,
      ]);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error("Weekly checkin cron error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
