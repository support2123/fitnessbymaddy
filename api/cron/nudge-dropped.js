const { supabase } = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

/**
 * Daily nudge cron — re-engages leads that dropped off in the last 7 days.
 * Only nudges once per lead and only if they haven't been contacted in 24 h.
 */

async function handler(req, res) {
  try {
    // 1. Authenticate
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // 2. Query recently dropped leads that haven't been contacted in 24 h
    const { data: leads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, phone, name, program_interest")
      .eq("status", "dropped")
      .gt("created_at", sevenDaysAgo)
      .lt("last_msg_at", twentyFourHoursAgo);

    if (fetchErr) {
      console.error("Failed to fetch dropped leads:", fetchErr.message);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (!leads || leads.length === 0) {
      console.log("No eligible dropped leads to nudge.");
      return res.status(200).json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { phone, name } = lead;

      // 3. Check if we already sent the reengagement template to this phone
      const { data: existing, error: msgErr } = await supabase
        .from("messages")
        .select("id")
        .eq("phone", phone)
        .eq("template_name", "reengagement_v1")
        .limit(1);

      if (msgErr) {
        console.error(
          `Failed to check messages for ${maskPhone(phone)}:`,
          msgErr.message
        );
        continue;
      }

      if (existing && existing.length > 0) {
        console.log(
          `Already nudged ${maskPhone(phone)} — skipping.`
        );
        continue;
      }

      // 4. Send re-engagement template with trial offer
      const displayName = name || "there";
      const result = await sendTemplate(phone, "reengagement_v1", [
        displayName,
      ]);

      if (result.success) {
        nudged++;
        console.log(`Nudged ${maskPhone(phone)} with reengagement_v1.`);
      } else {
        console.error(
          `Failed to nudge ${maskPhone(phone)}: ${result.reason}`
        );
      }
    }

    return res.status(200).json({ nudged });
  } catch (err) {
    console.error("nudge-dropped cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = handler;
