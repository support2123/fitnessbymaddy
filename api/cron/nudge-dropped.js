const { getSupabase } = require("../lib/supabase");
const { sendWhatsApp, maskPhone } = require("../lib/whatsapp");
const { logMessage, canSendMessage } = require("../lib/messages");

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const db = getSupabase();
  const results = { nudged_trial: 0, nudged_dropped: 0, skipped: 0 };

  try {
    const twoHoursAgo = new Date(
      Date.now() - 2 * 60 * 60 * 1000
    ).toISOString();
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: newLeads } = await db
      .from("leads")
      .select("*")
      .eq("status", "new")
      .lt("last_msg_at", twoHoursAgo)
      .gt("last_msg_at", twentyFourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        if (!(await canSendMessage(lead.phone))) {
          results.skipped++;
          continue;
        }
        await sendWhatsApp(lead.phone, "nudge_trial", {
          name: lead.name || "there",
          templateParams: [lead.name || "there"],
        });
        await logMessage(
          lead.phone,
          "out",
          "Trial nudge sent",
          "nudge_trial"
        );
        results.nudged_trial++;
        console.log(`[NUDGE] Trial nudge → ${maskPhone(lead.phone)}`);
      }
    }

    const { data: staleLeads } = await db
      .from("leads")
      .select("*")
      .eq("status", "new")
      .lt("last_msg_at", twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db
          .from("leads")
          .update({ status: "dropped" })
          .eq("id", lead.id);
      }
    }

    const { data: droppedLeads } = await db
      .from("leads")
      .select("*")
      .eq("status", "dropped")
      .gt("last_msg_at", sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: recentMsg } = await db
          .from("messages")
          .select("id")
          .eq("phone", lead.phone)
          .eq("direction", "out")
          .eq("template_name", "re_engage")
          .limit(1);

        if (recentMsg && recentMsg.length > 0) {
          results.skipped++;
          continue;
        }

        if (!(await canSendMessage(lead.phone))) {
          results.skipped++;
          continue;
        }

        await sendWhatsApp(lead.phone, "re_engage", {
          name: lead.name || "there",
          templateParams: [lead.name || "there"],
        });
        await logMessage(
          lead.phone,
          "out",
          "Re-engage nudge sent",
          "re_engage"
        );
        results.nudged_dropped++;
      }
    }

    const { data: pendingCheckins } = await db
      .from("clients")
      .select("id, phone, name, program_started_at")
      .eq("status", "active");

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor(
          (now - startDate) / (1000 * 60 * 60 * 24)
        );
        const weekNo = Math.floor(daysSinceStart / 7) + 1;
        const dayOfWeek = now.getDay();

        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: checkin } = await db
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          const nudgeDay = dayOfWeek === 1 ? "+24hrs" : "+48hrs";
          await sendWhatsApp(client.phone, "checkin_reminder", {
            name: client.name,
            templateParams: [client.name, String(weekNo)],
          });
          await logMessage(
            client.phone,
            "out",
            `Check-in nudge ${nudgeDay} week ${weekNo}`,
            "checkin_reminder"
          );
        }
      }
    }

    return res.json({ ok: true, results });
  } catch (err) {
    console.error("[NUDGE CRON]", err.message);
    return res.status(500).json({ error: "Cron failed" });
  }
};
