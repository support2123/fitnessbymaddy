const { supabase } = require("../_lib/supabase");
const { sendTemplate, logMessage } = require("../_lib/whatsapp");
const { notifyMaddy } = require("../_lib/escalation");

module.exports = async function handler(req, res) {
  try {
    // Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers["authorization"];
      if (authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const summary = {
      reengaged_leads: 0,
      checkin_nudges: 0,
      new_lead_nudges: 0,
      auto_dropped: 0,
      flagged_missed: 0,
      errors: [],
    };

    // ---------------------------------------------------------------
    // 1. Re-engage dropped leads (last_msg_at ~7 days ago, max 50)
    // ---------------------------------------------------------------
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

      const { data: droppedLeads, error: droppedErr } = await supabase
        .from("leads")
        .select("id, phone, name")
        .eq("status", "dropped")
        .gte("last_msg_at", eightDaysAgo)
        .lte("last_msg_at", sevenDaysAgo)
        .limit(50);

      if (droppedErr) {
        console.error(`[nudge-dropped] Error fetching dropped leads: ${droppedErr.message}`);
        summary.errors.push({ step: "reengagement", error: droppedErr.message });
      } else if (droppedLeads && droppedLeads.length > 0) {
        for (const lead of droppedLeads) {
          try {
            await sendTemplate(lead.phone, "reengagement_v1", [lead.name || "there"]);
            await logMessage(
              lead.phone,
              "outbound",
              `[template: reengagement_v1]`,
              "reengagement_v1"
            );
            summary.reengaged_leads++;
          } catch (sendErr) {
            console.error(`[nudge-dropped] Reengagement send error for ${lead.id}: ${sendErr.message}`);
            summary.errors.push({ step: "reengagement", lead_id: lead.id, error: sendErr.message });
          }
        }
      }
    } catch (err) {
      console.error(`[nudge-dropped] Reengagement block error: ${err.message}`);
      summary.errors.push({ step: "reengagement", error: err.message });
    }

    // ---------------------------------------------------------------
    // 2. Nudge pending check-ins (sent form but no submission, max 2 nudges)
    // ---------------------------------------------------------------
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Find checkin reminders sent in last 3 days
      const { data: checkinMessages, error: checkinMsgErr } = await supabase
        .from("messages")
        .select("phone, body, created_at")
        .eq("direction", "outbound")
        .eq("template_name", "weekly_checkin_reminder")
        .gte("created_at", threeDaysAgo);

      if (checkinMsgErr) {
        console.error(`[nudge-dropped] Error fetching checkin messages: ${checkinMsgErr.message}`);
        summary.errors.push({ step: "checkin_nudge", error: checkinMsgErr.message });
      } else if (checkinMessages && checkinMessages.length > 0) {
        // Get unique phones that received checkin reminders
        const phonesWithReminder = [...new Set(checkinMessages.map((m) => m.phone))];

        for (const phone of phonesWithReminder) {
          try {
            // Find the client
            const { data: client } = await supabase
              .from("clients")
              .select("id, program_started_at")
              .eq("phone", phone)
              .eq("status", "active")
              .maybeSingle();

            if (!client) continue;

            // Calculate current week
            const startDate = new Date(client.program_started_at);
            const now = new Date();
            const msPerWeek = 7 * 24 * 60 * 60 * 1000;
            const weekNo = Math.floor((now - startDate) / msPerWeek) + 1;

            // Check if checkin exists for this week
            const { data: existingCheckin } = await supabase
              .from("checkins")
              .select("id")
              .eq("client_id", client.id)
              .eq("week_no", weekNo)
              .limit(1)
              .maybeSingle();

            if (existingCheckin) continue; // Already submitted

            // Check how many nudges already sent for this check-in cycle
            const { data: nudgesSent, error: nudgeErr } = await supabase
              .from("messages")
              .select("id")
              .eq("phone", phone)
              .eq("direction", "outbound")
              .eq("template_name", "checkin_nudge")
              .gte("created_at", threeDaysAgo);

            if (nudgeErr) {
              console.error(`[nudge-dropped] Error checking nudge count: ${nudgeErr.message}`);
              continue;
            }

            const nudgeCount = nudgesSent ? nudgesSent.length : 0;

            // Max 2 nudges per check-in cycle
            if (nudgeCount >= 2) continue;

            // Only nudge after at least 24h since the reminder was sent
            const reminderMsg = checkinMessages.find((m) => m.phone === phone);
            if (reminderMsg && new Date(reminderMsg.created_at) > new Date(oneDayAgo)) {
              continue; // Less than 24h since reminder
            }

            await sendTemplate(phone, "checkin_nudge", [String(weekNo)]);
            await logMessage(
              phone,
              "outbound",
              `[template: checkin_nudge] Week ${weekNo}`,
              "checkin_nudge"
            );
            summary.checkin_nudges++;
          } catch (nudgeClientErr) {
            console.error(`[nudge-dropped] Checkin nudge error for ${phone}: ${nudgeClientErr.message}`);
            summary.errors.push({ step: "checkin_nudge", phone, error: nudgeClientErr.message });
          }
        }
      }
    } catch (err) {
      console.error(`[nudge-dropped] Checkin nudge block error: ${err.message}`);
      summary.errors.push({ step: "checkin_nudge", error: err.message });
    }

    // ---------------------------------------------------------------
    // 3. Nudge new leads who haven't replied (2h–24h old, only 1 message)
    // ---------------------------------------------------------------
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: newLeads, error: newLeadsErr } = await supabase
        .from("leads")
        .select("id, phone, name")
        .eq("status", "new")
        .lt("created_at", twoHoursAgo)
        .gt("created_at", oneDayAgo);

      if (newLeadsErr) {
        console.error(`[nudge-dropped] Error fetching new leads: ${newLeadsErr.message}`);
        summary.errors.push({ step: "new_lead_nudge", error: newLeadsErr.message });
      } else if (newLeads && newLeads.length > 0) {
        for (const lead of newLeads) {
          try {
            // Check message count — only nudge if there's exactly 1 message (our outbound)
            const { data: messages, error: msgErr } = await supabase
              .from("messages")
              .select("id")
              .eq("phone", lead.phone);

            if (msgErr) {
              console.error(`[nudge-dropped] Error checking messages for lead ${lead.id}: ${msgErr.message}`);
              continue;
            }

            if (messages && messages.length === 1) {
              await sendTemplate(lead.phone, "nudge_trial", [lead.name || "there"]);
              await logMessage(
                lead.phone,
                "outbound",
                `[template: nudge_trial]`,
                "nudge_trial"
              );
              summary.new_lead_nudges++;
            }
          } catch (nudgeErr) {
            console.error(`[nudge-dropped] New lead nudge error for ${lead.id}: ${nudgeErr.message}`);
            summary.errors.push({ step: "new_lead_nudge", lead_id: lead.id, error: nudgeErr.message });
          }
        }
      }
    } catch (err) {
      console.error(`[nudge-dropped] New lead nudge block error: ${err.message}`);
      summary.errors.push({ step: "new_lead_nudge", error: err.message });
    }

    // ---------------------------------------------------------------
    // 4. Auto-drop: new leads > 24h old with no reply
    // ---------------------------------------------------------------
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: staleLeads, error: staleErr } = await supabase
        .from("leads")
        .select("id, phone")
        .eq("status", "new")
        .lt("created_at", oneDayAgo);

      if (staleErr) {
        console.error(`[nudge-dropped] Error fetching stale leads: ${staleErr.message}`);
        summary.errors.push({ step: "auto_drop", error: staleErr.message });
      } else if (staleLeads && staleLeads.length > 0) {
        for (const lead of staleLeads) {
          try {
            // Check if lead has any inbound messages (replies)
            const { data: inboundMsgs, error: inboundErr } = await supabase
              .from("messages")
              .select("id")
              .eq("phone", lead.phone)
              .eq("direction", "inbound")
              .limit(1);

            if (inboundErr) {
              console.error(`[nudge-dropped] Error checking inbound for ${lead.id}: ${inboundErr.message}`);
              continue;
            }

            if (!inboundMsgs || inboundMsgs.length === 0) {
              // No reply — auto-drop
              const { error: dropErr } = await supabase
                .from("leads")
                .update({ status: "dropped" })
                .eq("id", lead.id);

              if (dropErr) {
                console.error(`[nudge-dropped] Error dropping lead ${lead.id}: ${dropErr.message}`);
              } else {
                summary.auto_dropped++;
              }
            }
          } catch (dropLeadErr) {
            console.error(`[nudge-dropped] Auto-drop error for ${lead.id}: ${dropLeadErr.message}`);
            summary.errors.push({ step: "auto_drop", lead_id: lead.id, error: dropLeadErr.message });
          }
        }
      }
    } catch (err) {
      console.error(`[nudge-dropped] Auto-drop block error: ${err.message}`);
      summary.errors.push({ step: "auto_drop", error: err.message });
    }

    // ---------------------------------------------------------------
    // 5. Flag missed check-ins: 2 consecutive missing -> notify Maddy
    // ---------------------------------------------------------------
    try {
      const { data: activeClients, error: activeErr } = await supabase
        .from("clients")
        .select("id, phone, name, program_started_at")
        .eq("status", "active");

      if (activeErr) {
        console.error(`[nudge-dropped] Error fetching active clients: ${activeErr.message}`);
        summary.errors.push({ step: "missed_checkins", error: activeErr.message });
      } else if (activeClients && activeClients.length > 0) {
        for (const client of activeClients) {
          try {
            if (!client.program_started_at) continue;

            const startDate = new Date(client.program_started_at);
            const now = new Date();
            const msPerWeek = 7 * 24 * 60 * 60 * 1000;
            const currentWeek = Math.floor((now - startDate) / msPerWeek) + 1;

            // Need at least 2 weeks of history to check consecutive misses
            if (currentWeek < 3) continue;

            // Check the last 2 completed weeks
            const weekToCheck1 = currentWeek - 1;
            const weekToCheck2 = currentWeek - 2;

            const { data: recentCheckins, error: checkinsErr } = await supabase
              .from("checkins")
              .select("week_no")
              .eq("client_id", client.id)
              .in("week_no", [weekToCheck1, weekToCheck2]);

            if (checkinsErr) {
              console.error(
                `[nudge-dropped] Error checking checkins for ${client.id}: ${checkinsErr.message}`
              );
              continue;
            }

            const submittedWeeks = recentCheckins ? recentCheckins.map((c) => c.week_no) : [];
            const missed1 = !submittedWeeks.includes(weekToCheck1);
            const missed2 = !submittedWeeks.includes(weekToCheck2);

            if (missed1 && missed2) {
              await notifyMaddy(
                `Client has missed 2 consecutive check-ins (weeks ${weekToCheck2} and ${weekToCheck1})`,
                {
                  phone: client.phone,
                  message: `Client: ${client.name || client.id}`,
                }
              );
              summary.flagged_missed++;
            }
          } catch (flagErr) {
            console.error(`[nudge-dropped] Missed checkin flag error for ${client.id}: ${flagErr.message}`);
            summary.errors.push({ step: "missed_checkins", client_id: client.id, error: flagErr.message });
          }
        }
      }
    } catch (err) {
      console.error(`[nudge-dropped] Missed checkins block error: ${err.message}`);
      summary.errors.push({ step: "missed_checkins", error: err.message });
    }

    return res.status(200).json({
      success: true,
      summary: {
        reengaged_leads: summary.reengaged_leads,
        checkin_nudges: summary.checkin_nudges,
        new_lead_nudges: summary.new_lead_nudges,
        auto_dropped: summary.auto_dropped,
        flagged_missed: summary.flagged_missed,
      },
      errors: summary.errors.length > 0 ? summary.errors : undefined,
    });
  } catch (err) {
    console.error(`[nudge-dropped] Error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
