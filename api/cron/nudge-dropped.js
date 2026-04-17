const { getSupabase } = require("../lib/supabase");
const { sendTemplate, sendText, detectMarket } = require("../lib/whatsapp");

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

    await nudgeNewLeads(db);
    await nudgeMissedCheckins(db);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Nudge cron error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};

async function nudgeNewLeads(db) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await db
    .from("leads")
    .select("*")
    .eq("status", "new")
    .lte("last_msg_at", twoHoursAgo)
    .gte("created_at", sevenDaysAgo);

  if (!staleLeads) return;

  for (const lead of staleLeads) {
    const lastContact = new Date(lead.last_msg_at);
    const hoursSinceContact = (Date.now() - lastContact.getTime()) / (1000 * 60 * 60);

    if (hoursSinceContact >= 24) {
      await db.from("leads").update({ status: "dropped" }).eq("id", lead.id);
      continue;
    }

    if (hoursSinceContact >= 2 && hoursSinceContact < 6) {
      await sendTemplate(lead.phone, "nudge_trial", [lead.name || "there"]);
    }
  }
}

async function nudgeMissedCheckins(db) {
  const { data: clients } = await db
    .from("clients")
    .select("*")
    .eq("status", "active");

  if (!clients) return;

  for (const client of clients) {
    const weekNo = getClientWeek(client);
    if (weekNo < 1) continue;

    const { data: checkin } = await db
      .from("checkins")
      .select("id")
      .eq("client_id", client.id)
      .eq("week_no", weekNo)
      .single();

    if (checkin) continue;

    const daysSinceLastSunday = getDaysSinceLastSunday();

    if (daysSinceLastSunday === 1 || daysSinceLastSunday === 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const isHinglish = market === "IN";

      let msg;
      if (isHinglish) {
        msg = `Reminder: Week ${weekNo} check-in abhi tak pending hai 📋\n${checkinUrl}\n\nBas 2 min lagenge!`;
      } else {
        msg = `Reminder: Your Week ${weekNo} check-in is still pending 📋\n${checkinUrl}\n\nJust 2 mins!`;
      }

      await sendText(client.phone, msg);
    }
  }
}

function getClientWeek(client) {
  if (!client.program_started_at) return 0;
  const start = new Date(client.program_started_at);
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function getDaysSinceLastSunday() {
  const now = new Date();
  return now.getDay() || 7;
}
