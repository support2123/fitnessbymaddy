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
    const missing = validateFields(body, ["lead_id", "name", "email"]);
    if (missing.length > 0) {
      return respond(res, 400, {
        error: "Missing required fields",
        fields: missing,
      });
    }

    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, experience_level } = body;

    // Build the intake data jsonb payload (all optional fields)
    const intakeData = {
      age: age || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
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
