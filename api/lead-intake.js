const supabase = require("../lib/supabase");
const { maskPhone } = require("../lib/helpers");
const { notifyMaddy } = require("../lib/escalate");

const REQUIRED_FIELDS = ["lead_id", "age", "goal"];

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
    } = req.body || {};

    // --- Validate required fields ---
    const missing = REQUIRED_FIELDS.filter((f) => !req.body[f]);
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ error: `Missing required fields: ${missing.join(", ")}` });
    }

    // --- Verify lead exists ---
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, phone, name")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr || !lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const masked = maskPhone(lead.phone);
    console.log(`[lead-intake] Intake submission for lead ${masked}`);

    // --- Update lead name if provided and missing ---
    if (name && !lead.name) {
      await supabase.from("leads").update({ name }).eq("id", lead_id);
    }

    // --- Store intake data as a metadata update on the lead ---
    // We store form data in a separate upsert to a lightweight approach:
    // attach it as a JSON column or use the existing fields.
    // For now, store key fields we can act on and log the rest.
    const intakeData = {
      email: email || null,
      age: parseInt(age, 10) || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      intake_submitted_at: new Date().toISOString(),
    };

    // Update the lead's name and store the intake timestamp
    const updates = { last_msg_at: new Date().toISOString() };
    if (name) updates.name = name;

    await supabase.from("leads").update(updates).eq("id", lead_id);

    // Log the intake as an inbound message for audit trail
    await supabase.from("messages").insert({
      phone: lead.phone,
      direction: "in",
      body: JSON.stringify(intakeData),
      template_name: "intake_form",
    });

    // --- Escalate if medical conditions mentioned ---
    if (medical_conditions && medical_conditions.trim().length > 0) {
      await notifyMaddy("Medical conditions reported in intake form", {
        lead_id,
        phone: masked,
        name: name || lead.name || "Unknown",
        medical_conditions,
      });
      console.log(`[lead-intake] Escalated: medical conditions for ${masked}`);
    }

    console.log(`[lead-intake] Intake stored for ${masked}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[lead-intake] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
