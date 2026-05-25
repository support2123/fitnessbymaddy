const { getSupabase } = require("../_lib/supabase");
const { sendWhatsApp } = require("../_lib/whatsapp");

/**
 * Daily nudge cron — re-engages dropped leads, nudges stale new leads,
 * marks abandoned new leads as dropped, and reminds clients about
 * outstanding check-in forms.
 */
module.exports = async (req, res) => {
  // ── Auth ────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const supabase = getSupabase();
  const now = new Date();
  let reengaged = 0;
  let nudged = 0;
  let dropped = 0;
  let checkinReminded = 0;

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Re-engage dropped leads (7-14 day window)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error: droppedErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("status", "dropped")
      .gt("updated_at", fourteenDaysAgo)
      .lt("updated_at", sevenDaysAgo);

    if (droppedErr) {
      console.error("[nudge] Failed to fetch dropped leads:", droppedErr.message);
    } else if (droppedLeads && droppedLeads.length > 0) {
      for (const lead of droppedLeads) {
        try {
          // Check for recent outbound messages (last 7 days)
          const { data: recentMsgs, error: msgErr } = await supabase
            .from("messages")
            .select("id")
            .eq("phone", lead.phone)
            .eq("direction", "out")
            .gte("created_at", sevenDaysAgo)
            .limit(1);

          if (msgErr) {
            console.error(`[nudge] Message check failed for lead ${lead.id}:`, msgErr.message);
            continue;
          }

          // Skip if we already messaged them in the last 7 days
          if (recentMsgs && recentMsgs.length > 0) {
            continue;
          }

          await sendWhatsApp(lead.phone, "reengagement_v1", [
            lead.name || "there",
            "$20", // trial offer price
          ]);
          reengaged++;
        } catch (err) {
          console.error(`[nudge] Failed to re-engage lead ${lead.id}:`, err.message);
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Nudge stale "new" leads (2-24 hours since last message)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads, error: staleErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("status", "new")
      .lt("last_msg_at", twoHoursAgo)
      .gt("last_msg_at", twentyFourHoursAgo);

    if (staleErr) {
      console.error("[nudge] Failed to fetch stale leads:", staleErr.message);
    } else if (staleLeads && staleLeads.length > 0) {
      for (const lead of staleLeads) {
        try {
          await sendWhatsApp(lead.phone, "lead_nudge", [
            lead.name || "there",
          ]);
          nudged++;
        } catch (err) {
          console.error(`[nudge] Failed to nudge lead ${lead.id}:`, err.message);
        }
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Mark abandoned "new" leads as dropped (24+ hours)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const { data: abandonedLeads, error: abandonedErr } = await supabase
      .from("leads")
      .select("id")
      .eq("status", "new")
      .lt("last_msg_at", twentyFourHoursAgo);

    if (abandonedErr) {
      console.error("[nudge] Failed to fetch abandoned leads:", abandonedErr.message);
    } else if (abandonedLeads && abandonedLeads.length > 0) {
      const ids = abandonedLeads.map((l) => l.id);

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "dropped" })
        .in("id", ids);

      if (updateErr) {
        console.error("[nudge] Failed to mark leads as dropped:", updateErr.message);
      } else {
        dropped = ids.length;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Remind clients who haven't submitted their check-in
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //
    // Find active clients who were sent a check-in form 24+ hours ago
    // but have no matching checkin row yet.
    //
    // We look at messages with the "weekly_checkin" template sent to
    // active clients and cross-reference with the checkins table.
    // ─────────────────────────────────────────────────────────────────

    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: activeClients, error: activeErr } = await supabase
      .from("clients")
      .select("id, phone, name")
      .eq("status", "active");

    if (activeErr) {
      console.error("[nudge] Failed to fetch active clients:", activeErr.message);
    } else if (activeClients && activeClients.length > 0) {
      for (const client of activeClients) {
        try {
          // Find the most recent check-in form sent to this client
          const { data: sentMsgs, error: sentErr } = await supabase
            .from("messages")
            .select("id, sent_at, template_name")
            .eq("phone", client.phone)
            .eq("direction", "out")
            .eq("template_name", "weekly_checkin")
            .lt("sent_at", oneDayAgo)
            .order("sent_at", { ascending: false })
            .limit(1);

          if (sentErr || !sentMsgs || sentMsgs.length === 0) {
            continue;
          }

          // Calculate the current week number
          const { data: clientData, error: cdErr } = await supabase
            .from("clients")
            .select("program_started_at")
            .eq("id", client.id)
            .single();

          if (cdErr || !clientData) continue;

          const startedAt = new Date(clientData.program_started_at);
          const msPerWeek = 7 * 24 * 60 * 60 * 1000;
          const weekNo = Math.floor((now - startedAt) / msPerWeek) + 1;

          // Check if checkin exists for this week
          const { data: checkins, error: ciErr } = await supabase
            .from("checkins")
            .select("id")
            .eq("client_id", client.id)
            .eq("week_no", weekNo)
            .limit(1);

          if (ciErr) {
            console.error(`[nudge] Checkin lookup failed for client ${client.id}:`, ciErr.message);
            continue;
          }

          // If no checkin submitted, send reminder
          if (!checkins || checkins.length === 0) {
            await sendWhatsApp(client.phone, "checkin_reminder", [
              client.name || "there",
              String(weekNo),
            ]);
            checkinReminded++;
          }
        } catch (err) {
          console.error(`[nudge] Checkin reminder failed for client ${client.id}:`, err.message);
        }
      }
    }

    console.log(
      `[nudge] Done — reengaged: ${reengaged}, nudged: ${nudged}, dropped: ${dropped}, checkin_reminded: ${checkinReminded}`
    );

    return res.status(200).json({
      reengaged,
      nudged,
      dropped,
      checkin_reminded: checkinReminded,
    });
  } catch (err) {
    console.error("[nudge] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
