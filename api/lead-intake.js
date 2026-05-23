const { getSupabase } = require("./lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      current_weight,
      target_weight,
      height,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      weekly_schedule,
      sleep_hours,
      stress_level,
      notes,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: "lead_id or phone required" });
    }

    const updateData = {
      last_msg_at: new Date().toISOString(),
    };
    if (name) updateData.name = name;

    const intakeData = {
      lead_id,
      name,
      email,
      phone,
      age: age ? parseInt(age, 10) : null,
      gender,
      goal,
      current_weight,
      target_weight,
      height,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      weekly_schedule,
      sleep_hours: sleep_hours ? parseInt(sleep_hours, 10) : null,
      stress_level,
      notes,
      submitted_at: new Date().toISOString(),
    };

    const { error: intakeError } = await db
      .from("intake_forms")
      .insert(intakeData);

    if (intakeError) {
      console.error("[INTAKE]", intakeError.message);
    }

    if (lead_id) {
      await db.from("leads").update(updateData).eq("id", lead_id);
    }

    return res.json({ ok: true, message: "Intake form submitted" });
  } catch (err) {
    console.error("[INTAKE ERROR]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
