const { getSupabase } = require("../../lib/supabase");
const { sendTemplate, canSendMessage } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await db
      .from("leads")
      .select("*")
      .eq("status", "new")
      .lte("created_at", twoDaysAgo)
      .gte("created_at", new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (newLeadsToNudge) {
      for (const lead of newLeadsToNudge) {
        try {
          const allowed = await canSendMessage(lead.phone);
          if (!allowed) continue;

          await sendTemplate(lead.phone, "nudge_trial", [
            lead.name || "there",
          ]);
          nudged++;
        } catch (err) {
          console.error(`Nudge failed ${maskPhone(lead.phone)}:`, err.message);
        }
      }
    }

    const { data: staleNewLeads } = await db
      .from("leads")
      .select("id, phone")
      .eq("status", "new")
      .lte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString())
      .lte("last_msg_at", new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let dropped = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        await db.from("leads").update({ status: "dropped" }).eq("id", lead.id);
        dropped++;
      }
    }

    const { data: droppedToReengage } = await db
      .from("leads")
      .select("*")
      .eq("status", "dropped")
      .gte("created_at", sevenDaysAgo)
      .lte("created_at", new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (droppedToReengage) {
      for (const lead of droppedToReengage) {
        try {
          const { data: msgCount } = await db
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("phone", lead.phone)
            .eq("direction", "out");

          if (msgCount && msgCount > 4) continue;

          const allowed = await canSendMessage(lead.phone);
          if (!allowed) continue;

          await sendTemplate(lead.phone, "reengage_offer", [
            lead.name || "there",
          ]);
          reengaged++;
        } catch (err) {
          console.error(`Reengage failed ${maskPhone(lead.phone)}:`, err.message);
        }
      }
    }

    const { data: pendingCheckins } = await db
      .from("clients")
      .select("id, phone, name, program_started_at")
      .eq("status", "active");

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: checkin } = await db
          .from("checkins")
          .select("id, form_submitted_at")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .maybeSingle();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          try {
            const allowed = await canSendMessage(client.phone);
            if (!allowed) continue;

            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, "checkin_reminder", [
              client.name || "there",
              `${weekNo}`,
              checkinUrl,
            ]);
            checkinNudges++;
          } catch (err) {
            console.error(`Checkin nudge failed ${maskPhone(client.phone)}:`, err.message);
          }
        }
      }
    }

    return res.status(200).json({
      action: "nudge_complete",
      nudged,
      dropped,
      reengaged,
      checkin_nudges: checkinNudges,
    });
  } catch (err) {
    console.error("nudge-dropped cron error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
