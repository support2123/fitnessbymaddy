const { supabase } = require("../_lib/supabase");
const { sendTemplate, notifyMaddy } = require("../_lib/whatsapp");
const { respond, maskPhone } = require("../_lib/helpers");

/* ── Helpers ──────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function logMessage(phone, direction, body) {
  const { error } = await supabase
    .from("messages")
    .insert({ phone, direction, body, sent_at: new Date().toISOString() });

  if (error) console.error("logMessage error:", error.message);
}

/* ── A) Re-engage dropped leads (7-day rule) ─────────────────────── */

async function reEngageDroppedLeads(summary) {
  const now = Date.now();
  const windowStart = new Date(now - 8 * DAY).toISOString();
  const windowEnd = new Date(now - 6 * DAY).toISOString();

  // Find leads dropped ~7 days ago
  const { data: droppedLeads, error: fetchErr } = await supabase
    .from("leads")
    .select("*")
    .eq("status", "dropped")
    .gte("last_msg_at", windowStart)
    .lte("last_msg_at", windowEnd)
    .limit(10);

  if (fetchErr) {
    console.error("Failed to fetch dropped leads:", fetchErr.message);
    summary.errors++;
    return;
  }

  if (!droppedLeads || droppedLeads.length === 0) return;

  for (const lead of droppedLeads) {
    try {
      // Check if re-engagement template was already sent
      const { data: alreadySent, error: checkErr } = await supabase
        .from("messages")
        .select("id")
        .eq("phone", lead.phone)
        .eq("direction", "out")
        .like("body", "%re_engage_7d%")
        .maybeSingle();

      if (checkErr) {
        console.error(`Message check error for ${maskPhone(lead.phone)}:`, checkErr.message);
        summary.errors++;
        continue;
      }

      if (alreadySent) {
        summary.re_engage_skipped++;
        continue;
      }

      const result = await sendTemplate(
        lead.phone,
        "re_engage_7d",
        [lead.name || "there"]
      );

      if (result.skipped) {
        summary.re_engage_skipped++;
        continue;
      }

      if (!result.ok) {
        console.error(`Re-engage send failed for ${maskPhone(lead.phone)}:`, result.error);
        summary.errors++;
        continue;
      }

      await logMessage(
        lead.phone,
        "out",
        "[template: re_engage_7d] 7-day re-engagement sent"
      );

      summary.re_engaged++;
    } catch (err) {
      console.error(`Error re-engaging ${maskPhone(lead.phone)}:`, err.message);
      summary.errors++;
    }
  }
}

/* ── B) Nudge pending check-ins ──────────────────────────────────── */

async function nudgePendingCheckins(summary) {
  const now = Date.now();

  // Find outbound weekly_checkin messages sent in the last 4 days
  const lookbackStart = new Date(now - 4 * DAY).toISOString();

  const { data: checkinMsgs, error: fetchErr } = await supabase
    .from("messages")
    .select("*")
    .eq("direction", "out")
    .like("body", "%weekly_checkin%")
    .gte("sent_at", lookbackStart)
    .order("sent_at", { ascending: false });

  if (fetchErr) {
    console.error("Failed to fetch checkin messages:", fetchErr.message);
    summary.errors++;
    return;
  }

  if (!checkinMsgs || checkinMsgs.length === 0) return;

  // Deduplicate by phone — only process the most recent checkin message per client
  const seen = new Set();
  const uniqueMsgs = [];
  for (const msg of checkinMsgs) {
    if (!seen.has(msg.phone)) {
      seen.add(msg.phone);
      uniqueMsgs.push(msg);
    }
  }

  for (const msg of uniqueMsgs) {
    try {
      // Extract week number from the message body
      const weekMatch = msg.body.match(/Week (\d+)/i);
      if (!weekMatch) continue;
      const weekNo = parseInt(weekMatch[1], 10);

      // Look up the client by phone
      const { data: client, error: clientErr } = await supabase
        .from("clients")
        .select("id, phone, name, status")
        .eq("phone", msg.phone)
        .eq("status", "active")
        .maybeSingle();

      if (clientErr || !client) continue;

      // Check if checkin was submitted
      const { data: checkin, error: checkinErr } = await supabase
        .from("checkins")
        .select("id")
        .eq("client_id", client.id)
        .eq("week_no", weekNo)
        .maybeSingle();

      if (checkinErr) {
        summary.errors++;
        continue;
      }

      // Checkin exists — no nudge needed
      if (checkin) continue;

      const sentAt = new Date(msg.sent_at).getTime();
      const elapsed = now - sentAt;

      if (elapsed >= 24 * HOUR && elapsed < 48 * HOUR) {
        // Check if 24h nudge was already sent for this phone recently
        const { data: alreadyNudged } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", msg.phone)
          .eq("direction", "out")
          .like("body", "%checkin_reminder_24h%")
          .gte("sent_at", msg.sent_at)
          .maybeSingle();

        if (alreadyNudged) continue;

        const result = await sendTemplate(
          client.phone,
          "checkin_reminder_24h",
          [client.name || "there", String(weekNo)],
          { isClient: true }
        );

        if (result.ok) {
          await logMessage(
            client.phone,
            "out",
            `[template: checkin_reminder_24h] Week ${weekNo} nudge sent`
          );
          summary.checkin_nudged_24h++;
        } else if (!result.skipped) {
          summary.errors++;
        }
      } else if (elapsed >= 48 * HOUR && elapsed < 72 * HOUR) {
        const { data: alreadyNudged } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", msg.phone)
          .eq("direction", "out")
          .like("body", "%checkin_reminder_48h%")
          .gte("sent_at", msg.sent_at)
          .maybeSingle();

        if (alreadyNudged) continue;

        const result = await sendTemplate(
          client.phone,
          "checkin_reminder_48h",
          [client.name || "there", String(weekNo)],
          { isClient: true }
        );

        if (result.ok) {
          await logMessage(
            client.phone,
            "out",
            `[template: checkin_reminder_48h] Week ${weekNo} nudge sent`
          );
          summary.checkin_nudged_48h++;
        } else if (!result.skipped) {
          summary.errors++;
        }
      } else if (elapsed >= 72 * HOUR) {
        // Potential churn risk — notify Maddy
        const { data: alreadyNotified } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", process.env.MADDY_PHONE)
          .eq("direction", "out")
          .like("body", `%churn risk%${maskPhone(client.phone)}%`)
          .gte("sent_at", msg.sent_at)
          .maybeSingle();

        if (alreadyNotified) continue;

        await notifyMaddy(
          `⚠️ Churn risk: ${client.name || "Unknown"} (${maskPhone(client.phone)}) ` +
          `missed Week ${weekNo} check-in for 72+ hours.`
        );
        summary.churn_alerts++;
      }
    } catch (err) {
      console.error(`Error nudging checkin for ${maskPhone(msg.phone)}:`, err.message);
      summary.errors++;
    }
  }
}

/* ── C) Nudge new leads (from Flow A) ────────────────────────────── */

async function nudgeNewLeads(summary) {
  const now = Date.now();

  // --- 2-hour nudge (±15 min window) ---
  const twoHoursAgoStart = new Date(now - 2 * HOUR - 15 * 60 * 1000).toISOString();
  const twoHoursAgoEnd = new Date(now - 2 * HOUR + 15 * 60 * 1000).toISOString();

  const { data: freshLeads, error: freshErr } = await supabase
    .from("leads")
    .select("*")
    .eq("status", "new")
    .gte("created_at", twoHoursAgoStart)
    .lte("created_at", twoHoursAgoEnd);

  if (freshErr) {
    console.error("Failed to fetch 2h leads:", freshErr.message);
    summary.errors++;
  } else if (freshLeads && freshLeads.length > 0) {
    for (const lead of freshLeads) {
      try {
        // Check if any inbound message exists from this lead (indicating a reply)
        const { data: inbound, error: inErr } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", lead.phone)
          .eq("direction", "in")
          .gt("sent_at", lead.created_at)
          .maybeSingle();

        if (inErr) {
          summary.errors++;
          continue;
        }

        // Lead replied — skip nudge
        if (inbound) continue;

        // Check if nudge_trial was already sent
        const { data: alreadyNudged } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", lead.phone)
          .eq("direction", "out")
          .like("body", "%nudge_trial%")
          .maybeSingle();

        if (alreadyNudged) continue;

        const trialUrl = `${process.env.BASE_URL || "https://fitnessbymaddy.com"}/checkout/zoom_trial`;

        const result = await sendTemplate(
          lead.phone,
          "nudge_trial",
          [lead.name || "there", trialUrl]
        );

        if (result.ok) {
          await logMessage(
            lead.phone,
            "out",
            `[template: nudge_trial] Trial nudge sent: ${trialUrl}`
          );
          summary.trial_nudged++;
        } else if (!result.skipped) {
          summary.errors++;
        }
      } catch (err) {
        console.error(`Error nudging fresh lead ${maskPhone(lead.phone)}:`, err.message);
        summary.errors++;
      }
    }
  }

  // --- 24-hour drop (±1 hour window) ---
  const oneDayAgoStart = new Date(now - 25 * HOUR).toISOString();
  const oneDayAgoEnd = new Date(now - 23 * HOUR).toISOString();

  const { data: staleLeads, error: staleErr } = await supabase
    .from("leads")
    .select("*")
    .eq("status", "new")
    .gte("created_at", oneDayAgoStart)
    .lte("created_at", oneDayAgoEnd);

  if (staleErr) {
    console.error("Failed to fetch 24h leads:", staleErr.message);
    summary.errors++;
  } else if (staleLeads && staleLeads.length > 0) {
    for (const lead of staleLeads) {
      try {
        // Check if any inbound reply exists
        const { data: inbound, error: inErr } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", lead.phone)
          .eq("direction", "in")
          .gt("sent_at", lead.created_at)
          .maybeSingle();

        if (inErr) {
          summary.errors++;
          continue;
        }

        // Lead replied — skip dropping
        if (inbound) continue;

        // Mark as dropped
        const { error: updateErr } = await supabase
          .from("leads")
          .update({ status: "dropped", last_msg_at: new Date().toISOString() })
          .eq("id", lead.id);

        if (updateErr) {
          console.error(`Failed to drop lead ${maskPhone(lead.phone)}:`, updateErr.message);
          summary.errors++;
          continue;
        }

        summary.leads_dropped++;
      } catch (err) {
        console.error(`Error dropping lead ${maskPhone(lead.phone)}:`, err.message);
        summary.errors++;
      }
    }
  }
}

/* ── Main handler ─────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  // Verify cron secret
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return respond(res, 401, { error: "Unauthorized" });
  }

  const summary = {
    re_engaged: 0,
    re_engage_skipped: 0,
    checkin_nudged_24h: 0,
    checkin_nudged_48h: 0,
    churn_alerts: 0,
    trial_nudged: 0,
    leads_dropped: 0,
    errors: 0,
  };

  try {
    // Run all three tasks — each handles its own errors internally
    await reEngageDroppedLeads(summary);
    await nudgePendingCheckins(summary);
    await nudgeNewLeads(summary);

    return respond(res, 200, { status: "ok", ...summary });
  } catch (err) {
    console.error("nudge-dropped cron error:", err);
    return respond(res, 500, { error: err.message, ...summary });
  }
};
