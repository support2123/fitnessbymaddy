const { getSupabase } = require("./_lib/supabase");
const { notifyMaddy } = require("./_lib/escalation");

// ---- CORS headers ----
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
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
    } = body;

    // ---- Validate required fields ----
    if (!lead_id || !name || !email) {
      return res.status(400).json({
        error: "Missing required fields: lead_id, name, and email are required",
      });
    }

    const supabase = getSupabase();

    // ---- Verify lead exists ----
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("id", lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // ---- Update lead with name ----
    await supabase
      .from("leads")
      .update({
        name,
        status: "qualified",
        last_msg_at: new Date().toISOString(),
      })
      .eq("id", lead_id);

    // ---- Store intake data ----
    const { error: intakeErr } = await supabase.from("intake_forms").insert({
      lead_id,
      name,
      email,
      age: age || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      created_at: new Date().toISOString(),
    });

    if (intakeErr) {
      console.error("[lead-intake] Failed to store intake:", intakeErr.message);
      return res.status(500).json({ error: "Failed to save intake form" });
    }

    // ---- Check medical conditions for escalation ----
    if (medical_conditions && medical_conditions.trim().length > 0) {
      await notifyMaddy("Medical conditions reported on intake form", {
        phone: lead.phone,
        message: `Medical conditions: ${medical_conditions}`,
        leadId: lead_id,
      });
    }

    console.log(`[lead-intake] Intake saved for lead ${lead_id}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[lead-intake] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
