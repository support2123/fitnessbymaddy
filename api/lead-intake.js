const { supabase } = require("../lib/supabase");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const lead_id = body.lead_id;
    const name = body.name || body.full_name;
    const email = body.email;
    const age = body.age;
    const gender = body.gender;
    const goal = body.goal || body.primary_goal;
    const injuries = body.injuries;
    const diet_pref = body.diet_pref || body.dietary_preference;
    const schedule = body.schedule || body.training_days;
    const medical_conditions = body.medical_conditions || body.medications;
    const current_fitness = body.current_fitness || body.fitness_level;
    const phone = body.phone;
    const gym_access = body.gym_access;
    const preferred_time = body.preferred_time || body.preferred_training_time;
    const additional_info = body.additional_info || body.anything_else;

    if (!lead_id) {
      return res.status(400).json({ error: "Missing lead_id" });
    }

    // ── Update lead record ────────────────────────────────────────
    const updateFields = {};
    if (name) updateFields.name = name;
    if (goal) updateFields.program_interest = goal;

    if (Object.keys(updateFields).length > 0) {
      const { error: leadError } = await supabase
        .from("leads")
        .update(updateFields)
        .eq("id", lead_id);

      if (leadError) {
        console.error(
          `[lead-intake] Failed to update lead ${lead_id}: ${leadError.message}`
        );
      }
    }

    // ── Check for existing client record linked to this lead ──────
    const { data: existingClient } = await supabase
      .from("clients")
      .select("id")
      .eq("lead_id", lead_id)
      .single();

    if (existingClient) {
      const clientUpdate = {};
      if (name) clientUpdate.name = name;
      if (email) clientUpdate.email = email;
      if (age) clientUpdate.age = age;
      if (gender) clientUpdate.gender = gender;
      if (goal) clientUpdate.goal = goal;
      if (injuries) clientUpdate.injuries = injuries;
      if (diet_pref) clientUpdate.diet_pref = diet_pref;
      if (schedule) clientUpdate.schedule = schedule;
      if (medical_conditions)
        clientUpdate.medical_conditions = medical_conditions;
      if (current_fitness) clientUpdate.current_fitness = current_fitness;

      if (Object.keys(clientUpdate).length > 0) {
        const { error: clientError } = await supabase
          .from("clients")
          .update(clientUpdate)
          .eq("id", existingClient.id);

        if (clientError) {
          console.error(
            `[lead-intake] Failed to update client ${existingClient.id}: ${clientError.message}`
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      message:
        "Intake form submitted successfully! We'll review your details and get back to you within 24 hours with your personalized plan.",
    });
  } catch (err) {
    console.error(`[lead-intake] Unhandled error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
