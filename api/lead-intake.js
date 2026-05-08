const { getSupabase } = require("../lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: "Missing lead_id" });

    const db = getSupabase();

    const { data: lead } = await db
      .from("leads")
      .select("id, phone, name")
      .eq("id", lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    await db
      .from("leads")
      .update({
        name: name || lead.name,
        intake_data: {
          email,
          age: parseInt(age) || null,
          gender,
          goal,
          injuries,
          diet_preference,
          schedule,
          medical_conditions,
          current_weight: parseFloat(current_weight) || null,
          target_weight: parseFloat(target_weight) || null,
          experience_level,
          submitted_at: new Date().toISOString(),
        },
      })
      .eq("id", lead_id);

    return res.status(200).json({ ok: true, message: "Intake saved" });
  } catch (err) {
    console.error("Intake error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
