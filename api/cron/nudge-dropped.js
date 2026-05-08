const { getSupabase } = require("../../lib/supabase");
const { sendWhatsApp, maskPhone } = require("../../lib/whatsapp");
const { detectMarket, isHinglish } = require("../../lib/market");

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getSupabase();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await db
      .from("leads")
      .select("id, phone, name, market")
      .eq("status", "new")
      .lt("last_msg_at", twoHoursAgo)
      .is("nudge_sent_at", null);

    let nudged = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        const template = isHinglish(lead.market) ? "nudge_trial_hi" : "nudge_trial";
        const result = await sendWhatsApp(lead.phone, template, [
          lead.name || "there",
          "https://fitnessbymaddy.com/program-trial.html",
        ]);
        if (result.ok) {
          await db
            .from("leads")
            .update({ nudge_sent_at: new Date().toISOString() })
            .eq("id", lead.id);
          nudged++;
        }
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from("leads")
      .select("id, phone")
      .eq("status", "new")
      .lt("last_msg_at", oneDayAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db
          .from("leads")
          .update({ status: "dropped" })
          .eq("id", lead.id);
        dropped++;
      }
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reEngageLeads } = await db
      .from("leads")
      .select("id, phone, name, market")
      .eq("status", "dropped")
      .gte("created_at", fourteenDaysAgo)
      .lt("created_at", sevenDaysAgo)
      .is("re_engage_sent_at", null);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const template = isHinglish(lead.market) ? "re_engage_hi" : "re_engage";
        const result = await sendWhatsApp(lead.phone, template, [
          lead.name || "there",
        ]);
        if (result.ok) {
          await db
            .from("leads")
            .update({ re_engage_sent_at: new Date().toISOString() })
            .eq("id", lead.id);
          reEngaged++;
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error("Nudge cron error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
