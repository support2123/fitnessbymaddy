const { getSupabase } = require("../../lib/supabase");
const { sendTemplate } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from("clients")
      .select("*")
      .eq("status", "active")
      .lte("program_started_at", new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ action: "no_active_clients" });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: existing } = await db
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .maybeSingle();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, "weekly_checkin", [
          client.name || "there",
          `${weekNo}`,
          checkinUrl,
        ]);

        sent++;
        console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
      } catch (clientErr) {
        errors++;
        console.error(`Failed for ${maskPhone(client.phone)}:`, clientErr.message);
      }
    }

    return res.status(200).json({
      action: "weekly_checkin_complete",
      total_clients: activeClients.length,
      sent,
      errors,
    });
  } catch (err) {
    console.error("weekly-checkin cron error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
