const { supabase } = require("./_lib/supabase");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body || {};

    // Validate required fields
    if (!name || !phone || !email || !goal) {
      return res.status(400).json({
        error: "Missing required fields: name, phone, email, and goal are required",
      });
    }

    // Check escalation keywords in injuries and medical_conditions
    const injuryCheck = checkEscalation(injuries);
    const medicalCheck = checkEscalation(medical_conditions);

    if (injuryCheck.shouldEscalate) {
      await notifyMaddy(injuryCheck.reason, {
        phone,
        message: `Intake form — injuries: ${injuries}`,
      });
    }

    if (medicalCheck.shouldEscalate) {
      await notifyMaddy(medicalCheck.reason, {
        phone,
        message: `Intake form — medical conditions: ${medical_conditions}`,
      });
    }

    // Prepare the form data for upsert
    const formData = {
      name,
      email,
      phone,
      age: age || null,
      gender: gender || null,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      current_weight: current_weight || null,
      target_weight: target_weight || null,
      medical_conditions: medical_conditions || null,
      intake_submitted_at: new Date().toISOString(),
    };

    // Find existing lead by phone
    const { data: existingLead, error: findError } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error(`[lead-intake] Error finding lead: ${findError.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (existingLead) {
      // Update existing lead
      const { error: updateError } = await supabase
        .from("leads")
        .update(formData)
        .eq("id", existingLead.id);

      if (updateError) {
        console.error(`[lead-intake] Error updating lead: ${updateError.message}`);
        return res.status(500).json({ error: "Internal server error" });
      }
    } else {
      // Create new lead
      const { error: insertError } = await supabase
        .from("leads")
        .insert({ ...formData, status: "new" });

      if (insertError) {
        console.error(`[lead-intake] Error creating lead: ${insertError.message}`);
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Form submitted successfully",
    });
  } catch (err) {
    console.error(`[lead-intake] Error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
