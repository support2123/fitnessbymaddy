const { getSupabase } = require("../lib/supabase");
const { cors } = require("../lib/utils");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: "lead_id or phone required" });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from("leads").select("*").eq("id", lead_id).maybeSingle();
      lead = data;
    } else {
      const { data } = await db.from("leads").select("*").eq("phone", phone).maybeSingle();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (name) {
      await db.from("leads").update({ name }).eq("id", lead.id);
    }

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
      email,
      intake_submitted_at: new Date().toISOString(),
    };

    await db.from("leads").update({
      name: name || lead.name,
      intake_data: intakeData,
    }).eq("id", lead.id);

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error("lead-intake error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
