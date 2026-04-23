const { supabase } = require("../_lib/supabase");
const { sendTemplate, logMessage } = require("../_lib/whatsapp");

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

    // Query all active clients
    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id, phone, name, program_type, program_started_at")
      .eq("status", "active");

    if (clientsError) {
      console.error(`[weekly-checkin] Error fetching clients: ${clientsError.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ success: true, messaged: 0, message: "No active clients" });
    }

    let messagedCount = 0;
    const errors = [];

    for (const client of clients) {
      try {
        // Calculate current week number
        if (!client.program_started_at) {
          console.log(`[weekly-checkin] Client ${client.id} has no program_started_at, skipping`);
          continue;
        }

        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weekNo = Math.floor((now - startDate) / msPerWeek) + 1;

        // Determine program duration
        const programDurations = {
          "6wk": 6,
          "8wk": 8,
          "12wk": 12,
        };
        const maxWeeks = programDurations[client.program_type] || 12;

        // Skip if week exceeds program duration
        if (weekNo > maxWeeks) {
          console.log(
            `[weekly-checkin] Client ${client.id} past program duration (week ${weekNo}/${maxWeeks}), skipping`
          );
          continue;
        }

        // Check if checkin already exists for this client + week
        const { data: existingCheckin } = await supabase
          .from("checkins")
          .select("id")
          .eq("client_id", client.id)
          .eq("week_no", weekNo)
          .limit(1)
          .maybeSingle();

        if (existingCheckin) {
          console.log(
            `[weekly-checkin] Client ${client.id} already checked in for week ${weekNo}, skipping`
          );
          continue;
        }

        // Send WhatsApp with check-in form link
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, "weekly_checkin_reminder", [
          client.name || "there",
          String(weekNo),
          checkinUrl,
        ]);

        // Log the outbound message
        await logMessage(
          client.phone,
          "outbound",
          `Time for your Week ${weekNo} check-in! Fill it out here: ${checkinUrl}`,
          "weekly_checkin_reminder"
        );

        // Insert nudge schedule marker so nudge-dropped cron can follow up
        await supabase.from("messages").insert({
          phone: client.phone,
          direction: "outbound",
          body: `Checkin nudge scheduled for client ${client.id} week ${weekNo}`,
          template_name: "checkin_nudge_scheduled",
        });

        messagedCount++;
      } catch (clientErr) {
        console.error(
          `[weekly-checkin] Error processing client ${client.id}: ${clientErr.message}`
        );
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      success: true,
      messaged: messagedCount,
      total_clients: clients.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error(`[weekly-checkin] Error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
