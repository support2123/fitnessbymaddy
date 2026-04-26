const { supabase } = require("../lib/supabase");
const { sendTemplate } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

async function handler(req, res) {
  try {
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    let nudged = 0;
    let dropped = 0;

    // Drop leads with no reply after 24 hours
    const { data: staleLeads, error: staleErr } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("status", "new")
      .lt("created_at", twentyFourHoursAgo);

    if (!staleErr && staleLeads) {
      for (const lead of staleLeads) {
        await supabase
          .from("leads")
          .update({ status: "dropped" })
          .eq("id", lead.id);
        dropped++;
        console.log(`Dropped stale lead ${maskPhone(lead.phone)}`);
      }
    }

    // Nudge leads who haven't replied after 2 hours (but less than 24)
    const { data: quietLeads, error: quietErr } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("status", "new")
      .lt("created_at", twoHoursAgo)
      .gt("created_at", twentyFourHoursAgo);

    if (!quietErr && quietLeads) {
      for (const lead of quietLeads) {
        const { data: existing } = await supabase
          .from("messages")
          .select("id")
          .eq("phone", lead.phone)
          .eq("template_name", "nudge_trial")
          .limit(1);

        if (existing && existing.length > 0) continue;

        const result = await sendTemplate(lead.phone, "nudge_trial", []);
        if (result.success) {
          nudged++;
          console.log(`Sent nudge_trial to ${maskPhone(lead.phone)}`);
        }
      }
    }

    return res.status(200).json({ nudged, dropped });
  } catch (err) {
    console.error("lead-followup cron error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = handler;
