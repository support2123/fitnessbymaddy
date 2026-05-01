const supabase = require("../../lib/supabase");
const { sendTemplate } = require("../../lib/whatsapp");
const { programDuration, maskPhone } = require("../../lib/helpers");

module.exports = async function handler(req, res) {
  try {
    // Verify cron secret
    if (
      req.headers["authorization"] !==
      `Bearer ${process.env.CRON_SECRET}`
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Fetch all active clients
    const { data: clients, error: fetchErr } = await supabase
      .from("clients")
      .select("id, phone, name, program, program_started_at")
      .eq("status", "active");

    if (fetchErr) {
      console.error("Failed to fetch clients:", fetchErr.message);
      return res.status(500).json({ error: "Database error" });
    }

    const now = new Date();
    let sent = 0;
    let completed = 0;
    let skipped = 0;

    for (const client of clients || []) {
      const startedAt = new Date(client.program_started_at);
      const msElapsed = now.getTime() - startedAt.getTime();
      const weekNo = Math.ceil(msElapsed / (7 * 24 * 60 * 60 * 1000));

      const duration = programDuration(client.program);

      // If program is complete, mark client as completed
      if (duration && weekNo > duration) {
        const { error: updateErr } = await supabase
          .from("clients")
          .update({ status: "completed" })
          .eq("id", client.id);

        if (updateErr) {
          console.error(
            `Failed to mark ${maskPhone(client.phone)} as completed:`,
            updateErr.message
          );
        } else {
          console.log(
            `Marked ${maskPhone(client.phone)} as completed (week ${weekNo} > ${duration})`
          );
        }
        completed++;
        continue;
      }

      // Check if checkin already exists for this week
      const { data: existing, error: checkinErr } = await supabase
        .from("checkins")
        .select("id")
        .eq("client_id", client.id)
        .eq("week_no", weekNo)
        .maybeSingle();

      if (checkinErr) {
        console.error(
          `Failed to check checkin for ${maskPhone(client.phone)}:`,
          checkinErr.message
        );
        skipped++;
        continue;
      }

      if (existing) {
        // Already submitted this week's check-in
        skipped++;
        continue;
      }

      // Send check-in form link via WhatsApp
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const displayName = client.name || "there";

      const result = await sendTemplate(client.phone, "weekly_checkin", [
        displayName,
        String(weekNo),
        checkinUrl,
      ]);

      if (result.success) {
        console.log(
          `Sent week ${weekNo} check-in to ${maskPhone(client.phone)}`
        );
        sent++;
      } else {
        console.error(
          `Failed to send check-in to ${maskPhone(client.phone)}:`,
          result.reason || result.error
        );
        skipped++;
      }
    }

    const summary = {
      total: (clients || []).length,
      sent,
      completed,
      skipped,
    };

    console.log("Weekly check-in summary:", JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error("weekly-checkin cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
