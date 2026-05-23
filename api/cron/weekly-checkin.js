const { getSupabase } = require("../lib/supabase");
const { sendWhatsApp, maskPhone } = require("../lib/whatsapp");
const { logMessage } = require("../lib/messages");
const { escalateToMaddy } = require("../lib/escalation");

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

  try {
    const { data: clients } = await db
      .from("clients")
      .select("*")
      .eq("status", "active");

    if (!clients || clients.length === 0) {
      return res.json({ message: "No active clients", results });
    }

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor(
          (now - startDate) / (1000 * 60 * 60 * 24)
        );
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: existing } = await db
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        const { data: missedCheckins } = await db
          .from("checkins")
          .select("week_no")
          .eq("client_id", client.id)
          .order("week_no", { ascending: false })
          .limit(3);

        const lastSubmittedWeek =
          missedCheckins && missedCheckins.length > 0
            ? missedCheckins[0].week_no
            : 0;
        const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy(
            "2 consecutive missed check-ins",
            client.phone,
            `${client.name} — missed weeks ${weekNo - 2} and ${weekNo - 1}`
          );
          results.escalated++;
        }

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "https://fitnessbymaddy.com";

        const checkinUrl = `${baseUrl}/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp(client.phone, "weekly_checkin", {
          name: client.name,
          templateParams: [client.name, String(weekNo), checkinUrl],
        });
        await logMessage(
          client.phone,
          "out",
          `Week ${weekNo} check-in reminder`,
          "weekly_checkin"
        );

        results.sent++;
        console.log(
          `[CHECKIN] Sent week ${weekNo} to ${maskPhone(client.phone)}`
        );
      } catch (clientErr) {
        console.error(
          `[CHECKIN] Error for ${maskPhone(client.phone)}:`,
          clientErr.message
        );
        results.errors++;
      }
    }

    return res.json({ ok: true, results });
  } catch (err) {
    console.error("[CRON CHECKIN]", err.message);
    return res.status(500).json({ error: "Cron failed" });
  }
};
