const { getSupabase } = require("../_lib/supabase");
const { sendWhatsApp } = require("../_lib/whatsapp");
const { notifyMaddy } = require("../_lib/escalation");

/**
 * Maximum weeks per program type.
 */
const PROGRAM_MAX_WEEKS = {
  "6wk_gym": 6,
  "6wk_home": 6,
  "12wk": 12,
  pcos: 6,
  "40plus": 6,
  zoom_trial: 1,
  zoom_pack: 4,
};

/**
 * GET /api/cron/weekly-checkin
 * Schedule: every Sunday at 9 AM IST (vercel.json: "30 3 * * 0")
 *
 * 1. Sends weekly check-in form links to all active clients.
 * 2. Nudges clients who haven't submitted their check-in form (24h, 48h).
 * 3. Escalates to Maddy when a client misses 2+ consecutive check-ins.
 */
module.exports = async function handler(req, res) {
  // ── Verify Vercel Cron auth ───────────────────────────────────────
  if (req.headers["authorization"] !== "Bearer " + process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabase();
  const now = new Date();

  const counts = { sent: 0, skipped: 0, completed: 0, nudged: 0, escalated: 0 };

  try {
    // ── Fetch all active clients ──────────────────────────────────────
    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, name, phone, program, program_started_at")
      .eq("status", "active");

    if (clientsErr) {
      console.error("[weekly-checkin] Error fetching clients:", clientsErr.message);
      return res.status(500).json({ error: "Failed to fetch clients" });
    }

    if (!clients || clients.length === 0) {
      console.log("[weekly-checkin] No active clients found");
      return res.status(200).json({ status: "done", ...counts });
    }

    // ── Process each active client ────────────────────────────────────
    for (const client of clients) {
      try {
        const startedAt = new Date(client.program_started_at);
        const msElapsed = now.getTime() - startedAt.getTime();
        const weekNo = Math.ceil(msElapsed / (7 * 24 * 60 * 60 * 1000));

        const maxWeeks = PROGRAM_MAX_WEEKS[client.program] || 6;

        // Program finished — skip (or mark completed)
        if (weekNo > maxWeeks) {
          const { error: completeErr } = await supabase
            .from("clients")
            .update({ status: "completed" })
            .eq("id", client.id);

          if (completeErr) {
            console.error(
              `[weekly-checkin] Error marking client ${client.id} completed:`,
              completeErr.message
            );
          } else {
            console.log(
              `[weekly-checkin] Client ${client.id} completed program (week ${weekNo} > ${maxWeeks})`
            );
          }
          counts.completed++;
          continue;
        }

        // Check if a check-in record already exists for this week
        const { data: existing, error: existErr } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .maybeSingle();

        if (existErr) {
          console.error(
            `[weekly-checkin] Error checking existing checkin for client ${client.id}:`,
            existErr.message
          );
        }

        if (existing) {
          counts.skipped++;
          continue;
        }

        // Build the check-in form URL
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        // Send WhatsApp template
        await sendWhatsApp(client.phone, "weekly_checkin", [
          client.name,
          String(weekNo),
          checkinUrl,
        ]);

        // Create placeholder checkin record (form_submitted_at left null)
        const { error: insertErr } = await supabase.from("checkins").insert({
          client_id: client.id,
          week_no: weekNo,
          sent_at: now.toISOString(),
        });

        if (insertErr) {
          console.error(
            `[weekly-checkin] Error inserting checkin for client ${client.id}:`,
            insertErr.message
          );
        }

        console.log(
          `[weekly-checkin] Sent check-in to client ${client.id} (week ${weekNo})`
        );
        counts.sent++;
      } catch (err) {
        console.error(
          `[weekly-checkin] Error processing client ${client.id}:`,
          err.message
        );
        counts.skipped++;
      }
    }

    // ── Nudge logic: pending check-ins without form submission ────────
    await handleNudges(supabase, now, counts);

    console.log("[weekly-checkin] Finished:", counts);
    return res.status(200).json({ status: "done", ...counts });
  } catch (err) {
    console.error("[weekly-checkin] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Send nudges for overdue check-ins and escalate for repeated misses.
 */
async function handleNudges(supabase, now, counts) {
  // Find all checkin records that were sent but never submitted
  const { data: pending, error: pendingErr } = await supabase
    .from("checkins")
    .select("id, client_id, week_no, sent_at, nudge_count")
    .is("form_submitted_at", null)
    .not("sent_at", "is", null);

  if (pendingErr) {
    console.error("[weekly-checkin] Error fetching pending checkins:", pendingErr.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  for (const checkin of pending) {
    try {
      const sentAt = new Date(checkin.sent_at);
      const hoursElapsed = (now.getTime() - sentAt.getTime()) / (60 * 60 * 1000);
      const nudgeCount = checkin.nudge_count || 0;

      // 24+ hours: first nudge
      if (hoursElapsed >= 24 && nudgeCount === 0) {
        // Fetch client details for the nudge
        const { data: client } = await supabase
          .from("clients")
          .select("name, phone")
          .eq("id", checkin.client_id)
          .single();

        if (!client) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}`;

        await sendWhatsApp(client.phone, "checkin_nudge", [
          client.name,
          String(checkin.week_no),
          checkinUrl,
        ]);

        await supabase
          .from("checkins")
          .update({ nudge_count: 1 })
          .eq("id", checkin.id);

        console.log(
          `[weekly-checkin] Sent 1st nudge to client ${checkin.client_id} (week ${checkin.week_no})`
        );
        counts.nudged++;
      }

      // 48+ hours: second nudge
      if (hoursElapsed >= 48 && nudgeCount === 1) {
        const { data: client } = await supabase
          .from("clients")
          .select("name, phone")
          .eq("id", checkin.client_id)
          .single();

        if (!client) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}`;

        await sendWhatsApp(client.phone, "checkin_nudge_final", [
          client.name,
          String(checkin.week_no),
          checkinUrl,
        ]);

        await supabase
          .from("checkins")
          .update({ nudge_count: 2 })
          .eq("id", checkin.id);

        console.log(
          `[weekly-checkin] Sent 2nd nudge to client ${checkin.client_id} (week ${checkin.week_no})`
        );
        counts.nudged++;
      }

      // Check for 2+ consecutive missed check-ins — escalate to Maddy
      if (nudgeCount >= 2) {
        const { data: missedCheckins, error: missedErr } = await supabase
          .from("checkins")
          .select("week_no")
          .eq("client_id", checkin.client_id)
          .is("form_submitted_at", null)
          .gte("nudge_count", 2)
          .order("week_no", { ascending: false })
          .limit(2);

        if (missedErr) {
          console.error(
            `[weekly-checkin] Error checking missed streaks for client ${checkin.client_id}:`,
            missedErr.message
          );
          continue;
        }

        // If there are 2+ missed checkins with exhausted nudges, escalate
        if (missedCheckins && missedCheckins.length >= 2) {
          const { data: client } = await supabase
            .from("clients")
            .select("name, phone")
            .eq("id", checkin.client_id)
            .single();

          if (client) {
            await notifyMaddy("missed_checkins", {
              phone: client.phone,
              message: `${client.name} has missed ${missedCheckins.length} consecutive weekly check-ins (weeks ${missedCheckins.map((c) => c.week_no).join(", ")}).`,
            });

            console.log(
              `[weekly-checkin] Escalated client ${checkin.client_id} to Maddy (${missedCheckins.length} missed)`
            );
            counts.escalated++;
          }
        }
      }
    } catch (err) {
      console.error(
        `[weekly-checkin] Error nudging checkin ${checkin.id}:`,
        err.message
      );
    }
  }
}
