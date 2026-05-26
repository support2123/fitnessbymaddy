const { supabase } = require("../_lib/supabase");
const { sendTemplate } = require("../_lib/whatsapp");

function verifyCron(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const summary = {
    re_engage_sent: 0,
    new_lead_nudges: 0,
    marked_dropped: 0,
    errors: [],
  };

  try {
    const now = new Date();

    // -------------------------------------------------------
    // 1. Re-engage dropped leads (7-14 days since last msg)
    // -------------------------------------------------------
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: droppedLeads, error: droppedErr } = await supabase
      .from("leads")
      .select("id, phone, name, last_msg_at")
      .eq("status", "dropped")
      .lte("last_msg_at", sevenDaysAgo.toISOString())
      .gte("last_msg_at", fourteenDaysAgo.toISOString());

    if (droppedErr) {
      console.error("Failed to fetch dropped leads:", droppedErr.message);
      summary.errors.push("dropped leads query failed");
    } else if (droppedLeads && droppedLeads.length > 0) {
      for (const lead of droppedLeads) {
        try {
          await sendTemplate(lead.phone, "re_engage_v1", [
            lead.name || "there",
          ]);

          await supabase
            .from("leads")
            .update({ last_msg_at: now.toISOString() })
            .eq("id", lead.id);

          summary.re_engage_sent++;
        } catch (sendErr) {
          console.error(`Re-engage failed for lead ${lead.id}:`, sendErr.message);
          summary.errors.push(`re-engage send failed: lead ${lead.id}`);
        }
      }
    }

    // -------------------------------------------------------
    // 2. Nudge new leads with no reply after 2 hours
    // -------------------------------------------------------
    const twoHoursAgo = new Date(now);
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    const twentyFourHoursAgo = new Date(now);
    twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);

    // Leads created > 2hrs ago but < 24hrs ago, with no reply
    const { data: newLeadsToNudge, error: nudgeErr } = await supabase
      .from("leads")
      .select("id, phone, name, created_at, reply_received")
      .eq("status", "new")
      .eq("reply_received", false)
      .lte("created_at", twoHoursAgo.toISOString())
      .gte("created_at", twentyFourHoursAgo.toISOString());

    if (nudgeErr) {
      console.error("Failed to fetch new leads for nudge:", nudgeErr.message);
      summary.errors.push("new leads nudge query failed");
    } else if (newLeadsToNudge && newLeadsToNudge.length > 0) {
      for (const lead of newLeadsToNudge) {
        try {
          await sendTemplate(lead.phone, "nudge_trial", [
            lead.name || "there",
          ]);
          summary.new_lead_nudges++;
        } catch (sendErr) {
          console.error(`Nudge failed for lead ${lead.id}:`, sendErr.message);
          summary.errors.push(`nudge send failed: lead ${lead.id}`);
        }
      }
    }

    // -------------------------------------------------------
    // 3. Mark stale new leads as dropped (> 24hrs, no reply)
    // -------------------------------------------------------
    const { data: staleLeads, error: staleErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("status", "new")
      .eq("reply_received", false)
      .lte("created_at", twentyFourHoursAgo.toISOString());

    if (staleErr) {
      console.error("Failed to fetch stale leads:", staleErr.message);
      summary.errors.push("stale leads query failed");
    } else if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map((l) => l.id);

      const { error: updateErr } = await supabase
        .from("leads")
        .update({
          status: "dropped",
          last_msg_at: now.toISOString(),
        })
        .in("id", staleIds);

      if (updateErr) {
        console.error("Failed to mark leads as dropped:", updateErr.message);
        summary.errors.push("mark dropped update failed");
      } else {
        summary.marked_dropped = staleIds.length;
      }
    }

    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error("nudge-dropped cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
