const { supabase } = require("../_lib/supabase");
const { sendTemplate, sendText } = require("../_lib/whatsapp");
const { notifyMaddy } = require("../_lib/escalation");

function verifyCron(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return false;
  }
  return true;
}

function getWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!verifyCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const summary = {
    reminders_sent: 0,
    nudges_sent: 0,
    completed: 0,
    skipped_already_submitted: 0,
    escalations: 0,
    errors: [],
  };

  try {
    // --- fetch all active clients ---
    const { data: clients, error: clientsErr } = await supabase
      .from("clients")
      .select("id, phone, name, status, program_started_at, program_ends_at")
      .eq("status", "active");

    if (clientsErr) {
      console.error("Failed to fetch clients:", clientsErr.message);
      return res.status(500).json({ error: "Failed to fetch clients" });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ success: true, summary, message: "No active clients" });
    }

    const now = new Date();

    for (const client of clients) {
      try {
        // --- check if program has ended ---
        if (client.program_ends_at && new Date(client.program_ends_at) < now) {
          await supabase
            .from("clients")
            .update({ status: "completed" })
            .eq("id", client.id);

          try {
            await sendText(
              client.phone,
              `Congratulations on completing your program! You've done amazing work. Let's chat about your next steps — reply here or book a call with Maddy.`
            );
          } catch (msgErr) {
            console.error(`Completion msg failed for ${client.id}:`, msgErr.message);
          }

          summary.completed++;
          continue;
        }

        // --- determine current week ---
        if (!client.program_started_at) {
          summary.errors.push(`Client ${client.id}: no program_started_at`);
          continue;
        }

        const weekNo = getWeekNo(client.program_started_at);

        // --- check if check-in already submitted this week ---
        const { data: existing, error: existingErr } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .limit(1);

        if (existingErr) {
          summary.errors.push(`Client ${client.id}: checkin query error`);
          continue;
        }

        if (existing && existing.length > 0) {
          summary.skipped_already_submitted++;
          continue;
        }

        // --- send check-in form link ---
        const formUrl = `fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        try {
          await sendText(
            client.phone,
            `Hey ${client.name || ""}! It's check-in day. Please fill out your Week ${weekNo} check-in here: ${formUrl}\n\nThis helps me tailor your program for the best results.`
          );
          summary.reminders_sent++;
        } catch (sendErr) {
          summary.errors.push(`Client ${client.id}: reminder send failed`);
          console.error(`Reminder failed for ${client.id}:`, sendErr.message);
        }

        // --- check for missed check-ins (previous weeks) ---
        // 24hr nudge: last week's check-in missing
        const prevWeek = weekNo - 1;
        if (prevWeek >= 1) {
          const { data: prevCheckin } = await supabase
            .from("checkins")
            .select("id")
            .eq("client_id", client.id)
            .eq("week_no", prevWeek)
            .limit(1);

          if (!prevCheckin || prevCheckin.length === 0) {
            // previous week was missed — send nudge
            try {
              await sendText(
                client.phone,
                `Reminder: I haven't received your Week ${prevWeek} check-in yet. Your check-in helps me adjust your program. Please submit it when you can: ${formUrl.replace(`w=${weekNo}`, `w=${prevWeek}`)}`
              );
              summary.nudges_sent++;
            } catch (nudgeErr) {
              console.error(`Nudge failed for ${client.id}:`, nudgeErr.message);
            }

            // check for 2 consecutive missed check-ins
            const prevPrevWeek = prevWeek - 1;
            if (prevPrevWeek >= 1) {
              const { data: prevPrevCheckin } = await supabase
                .from("checkins")
                .select("id")
                .eq("client_id", client.id)
                .eq("week_no", prevPrevWeek)
                .limit(1);

              if (!prevPrevCheckin || prevPrevCheckin.length === 0) {
                // 2 consecutive missed check-ins — escalate
                try {
                  await notifyMaddy("2 consecutive missed check-ins", {
                    clientPhone: client.phone,
                    messageBody: `Client ${client.name || client.id} has missed check-ins for weeks ${prevPrevWeek} and ${prevWeek}`,
                  });
                  summary.escalations++;
                } catch (escErr) {
                  console.error(`Escalation failed for ${client.id}:`, escErr.message);
                }
              }
            }
          }
        }
      } catch (clientErr) {
        summary.errors.push(`Client ${client.id}: ${clientErr.message}`);
        console.error(`Error processing client ${client.id}:`, clientErr.message);
      }
    }

    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error("weekly-checkin cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
