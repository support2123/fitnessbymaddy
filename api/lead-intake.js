const { supabase } = require("./_lib/supabase");
const { sendText } = require("./_lib/whatsapp");

const CHECKOUT_BASE = process.env.EXLY_CHECKOUT_BASE || "https://www.exlyapp.com/fitnessbymaddy";

const PROGRAM_CHECKOUTS = {
  "6wk": `${CHECKOUT_BASE}/6wk-shred`,
  pcos: `${CHECKOUT_BASE}/pcos`,
  "40plus": `${CHECKOUT_BASE}/40plus`,
  "12wk": `${CHECKOUT_BASE}/12wk-flagship`,
  trial: `${CHECKOUT_BASE}/zoom-trial`,
};

/** Mask phone for safe logging. */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, -4).replace(/.(?=.{2})/g, "*").slice(0, -2) + phone.slice(-4, -2) + "**";
}

module.exports = async function handler(req, res) {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const {
      name,
      email,
      phone,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      lead_id,
    } = req.body || {};

    if (!phone && !lead_id) {
      return res.status(400).json({ success: false, error: "phone or lead_id required" });
    }

    // Build update payload — only include fields that were provided
    const update = { updated_at: new Date().toISOString() };
    if (name) update.name = name;
    if (email) update.email = email;
    if (age) update.age = Number(age) || null;
    if (goal) update.goal = goal;
    if (injuries) update.injuries = injuries;
    if (diet_pref) update.diet_pref = diet_pref;
    if (schedule) update.schedule = schedule;
    update.intake_completed = true;

    // Find and update the lead
    let query = supabase.from("leads");
    if (lead_id) {
      query = query.update(update).eq("id", lead_id);
    } else {
      query = query.update(update).eq("phone", phone);
    }
    const { error: updateErr } = await query.select("*").single();

    if (updateErr) {
      console.error(`[intake] Update failed for ${maskPhone(phone)}:`, updateErr.message);
      return res.status(200).json({ success: false, error: "lead not found" });
    }

    // Fetch the full lead to check if we should send a checkout reminder
    const lookupCol = lead_id ? "id" : "phone";
    const lookupVal = lead_id || phone;
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq(lookupCol, lookupVal)
      .maybeSingle();

    if (lead && lead.program_interest && lead.status !== "converted") {
      const checkoutUrl = PROGRAM_CHECKOUTS[lead.program_interest];
      if (checkoutUrl && lead.phone) {
        try {
          const msg = [
            `Thanks for completing your intake form, ${lead.name || ""}!`,
            "",
            `When you're ready, here's your checkout link:`,
            checkoutUrl,
            "",
            `I'll start building your personalised plan as soon as you're in.`,
          ].join("\n");

          await sendText(lead.phone, msg);
        } catch (sendErr) {
          console.error(`[intake] Reminder send failed for ${maskPhone(lead.phone)}:`, sendErr.message);
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[intake] Unhandled error:", err.message);
    return res.status(200).json({ success: false, error: "internal error" });
  }
};
