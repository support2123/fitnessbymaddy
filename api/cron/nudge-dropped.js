const supabase = require("../../lib/supabase");
const { sendTemplate } = require("../../lib/whatsapp");
const { maskPhone } = require("../../lib/helpers");
const { notifyMaddy } = require("../../lib/escalate");

module.exports = async function handler(req, res) {
  try {
    // Verify cron secret
    if (
      req.headers["authorization"] !==
      `Bearer ${process.env.CRON_SECRET}`
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();
    const summary = { nudged: 0, dropped: 0, escalated: 0, reengaged: 0 };

    // ── Part 1: Nudge leads idle 2-24 hours ────────────────────────
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads, error: nudgeErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("status", "new")
      .lt("last_msg_at", twoHoursAgo)
      .gte("last_msg_at", twentyFourHoursAgo);

    if (nudgeErr) {
      console.error("Nudge query failed:", nudgeErr.message);
    } else {
      for (const lead of nudgeLeads || []) {
        const trialLink = "https://exly.in/fitnessbymaddy/zoom-trial-session";
        const displayName = lead.name || "there";

        const result = await sendTemplate(lead.phone, "nudge_trial", [
          displayName,
          trialLink,
        ]);

        if (result.success) {
          console.log(`Nudged ${maskPhone(lead.phone)}`);
          summary.nudged++;
        }
      }
    }

    // ── Part 2: Mark leads as dropped after 24 hours ───────────────
    const { data: dropLeads, error: dropErr } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("status", "new")
      .lt("last_msg_at", twentyFourHoursAgo);

    if (dropErr) {
      console.error("Drop query failed:", dropErr.message);
    } else {
      for (const lead of dropLeads || []) {
        const { error: updateErr } = await supabase
          .from("leads")
          .update({ status: "dropped" })
          .eq("id", lead.id);

        if (!updateErr) {
          console.log(`Dropped ${maskPhone(lead.phone)}`);
          summary.dropped++;
        } else {
          console.error(
            `Failed to drop ${maskPhone(lead.phone)}:`,
            updateErr.message
          );
        }
      }
    }

    // ── Part 3: Escalate clients with 2+ consecutive missed check-ins
    const { data: activeClients, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, name, program, program_started_at")
      .eq("status", "active");

    if (clientErr) {
      console.error("Active clients query failed:", clientErr.message);
    } else {
      for (const client of activeClients || []) {
        const startedAt = new Date(client.program_started_at);
        const msElapsed = now.getTime() - startedAt.getTime();
        const currentWeek = Math.ceil(msElapsed / (7 * 24 * 60 * 60 * 1000));

        // Need at least 2 weeks elapsed to check for consecutive misses
        if (currentWeek < 2) continue;

        // Fetch all check-ins for this client
        const { data: checkins, error: ciErr } = await supabase
          .from("checkins")
          .select("week_no")
          .eq("client_id", client.id)
          .order("week_no", { ascending: false });

        if (ciErr) {
          console.error(
            `Checkin query failed for ${maskPhone(client.phone)}:`,
            ciErr.message
          );
          continue;
        }

        const submittedWeeks = new Set(
          (checkins || []).map((c) => c.week_no)
        );

        // Check the two most recent expected weeks
        let consecutiveMisses = 0;
        for (let w = currentWeek; w >= 1 && consecutiveMisses < 2; w--) {
          if (!submittedWeeks.has(w)) {
            consecutiveMisses++;
          } else {
            break;
          }
        }

        if (consecutiveMisses >= 2) {
          await notifyMaddy("Consecutive missed check-ins", {
            phone: maskPhone(client.phone),
            context: `${client.name || "Unknown"} missed ${consecutiveMisses} consecutive check-ins (current week: ${currentWeek}, program: ${client.program})`,
          });
          console.log(
            `Escalated ${maskPhone(client.phone)}: ${consecutiveMisses} missed check-ins`
          );
          summary.escalated++;
        }
      }
    }

    // ── Part 4: Re-engage leads dropped exactly 7 days ago ─────────
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoStart = new Date(sevenDaysAgo);
    sevenDaysAgoStart.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgoEnd = new Date(sevenDaysAgo);
    sevenDaysAgoEnd.setUTCHours(23, 59, 59, 999);

    const { data: reengageLeads, error: reErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("status", "dropped")
      .gte("created_at", sevenDaysAgoStart.toISOString())
      .lte("created_at", sevenDaysAgoEnd.toISOString());

    if (reErr) {
      console.error("Re-engage query failed:", reErr.message);
    } else {
      for (const lead of reengageLeads || []) {
        const displayName = lead.name || "there";

        const result = await sendTemplate(lead.phone, "reengage_7day", [
          displayName,
        ]);

        if (result.success) {
          console.log(`Re-engaged ${maskPhone(lead.phone)}`);
          summary.reengaged++;
        }
      }
    }

    console.log("nudge-dropped summary:", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error("nudge-dropped cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
