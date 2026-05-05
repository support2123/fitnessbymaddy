const { supabase } = require("./_lib/supabase");
const { respond, parseBody, validateFields } = require("./_lib/helpers");

module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    return respond(res, 204, null);
  }

  if (req.method !== "POST") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);

    // Validate required fields
    const name = body.name || body.full_name;
    const email = body.email;
    const leadId = body.lead_id;

    if (!leadId || !name || !email) {
      const missing = [];
      if (!leadId) missing.push("lead_id");
      if (!name) missing.push("name");
      if (!email) missing.push("email");
      return respond(res, 400, {
        error: "Missing required fields",
        fields: missing,
      });
    }

    const lead_id = leadId;

    const intakeData = {
      age: body.age || null,
      gender: body.gender || null,
      goal: body.goal || body.primary_goal || null,
      injuries: body.injuries || null,
      diet_pref: body.diet_pref || body.diet_preference || null,
      schedule: body.schedule || body.training_days || null,
      experience_level: body.experience_level || null,
      gym_access: body.gym_access || null,
      additional_notes: body.additional_notes || null,
      phone: body.phone || null,
      submitted_at: new Date().toISOString(),
    };

    // Update the lead record with name, email, and intake_data jsonb
    const { data, error } = await supabase
      .from("leads")
      .update({
        name,
        email,
        intake_data: intakeData,
      })
      .eq("id", lead_id)
      .select()
      .single();

    if (error) {
      console.error("lead-intake update error:", error.message);

      // Distinguish "not found" from other errors
      if (error.code === "PGRST116") {
        return respond(res, 404, { error: "Lead not found" });
      }

      return respond(res, 500, { error: "Failed to update lead record" });
    }

    return respond(res, 200, {
      status: "ok",
      lead_id: data.id,
      message: "Intake data saved successfully",
    });
  } catch (err) {
    console.error("lead-intake error:", err);
    return respond(res, 500, { error: err.message });
  }
};
