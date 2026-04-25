const { getSupabase } = require("../lib/supabase");
const { sendText } = require("../lib/whatsapp");
const { checkEscalation } = require("../lib/escalation");

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-2);
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = getSupabase();
    const {
      lead_id,
      name,
      age,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
      phone,
      email,
    } = req.body || {};

    /* ---- validate required fields ---- */
    const missing = [];
    if (!name) missing.push("name");
    if (!phone) missing.push("phone");
    if (!goal) missing.push("goal");
    if (missing.length > 0) {
      return res.status(400).json({
        error: "Missing required fields",
        fields: missing,
      });
    }

    /* ---- find or identify lead ---- */
    let targetLeadId = lead_id;
    if (!targetLeadId) {
      // Look up by phone
      const { data: leadRows } = await supabase
        .from("leads")
        .select("id")
        .eq("phone", phone)
        .limit(1);
      if (leadRows && leadRows.length > 0) {
        targetLeadId = leadRows[0].id;
      }
    }

    /* ---- update lead with intake info ---- */
    const intakeData = {};
    if (name) intakeData.name = name;
    if (email) intakeData.email = email;

    // Store extended intake data in a structured way
    // These fields map to columns if they exist, or go into a JSON catch-all
    const intakeMetadata = {};
    if (age) intakeMetadata.age = age;
    if (gender) intakeMetadata.gender = gender;
    if (goal) intakeMetadata.goal = goal;
    if (injuries) intakeMetadata.injuries = injuries;
    if (diet_pref) intakeMetadata.diet_pref = diet_pref;
    if (schedule) intakeMetadata.schedule = schedule;
    if (medical_conditions) intakeMetadata.medical_conditions = medical_conditions;

    if (targetLeadId) {
      await supabase
        .from("leads")
        .update({
          ...intakeData,
          last_msg_at: new Date().toISOString(),
        })
        .eq("id", targetLeadId);
    } else {
      // Create new lead from intake form
      const { data: newLead } = await supabase
        .from("leads")
        .insert({
          phone,
          name,
          source: "intake_form",
          status: "qualified",
          last_msg_at: new Date().toISOString(),
          program_interest: goal,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (newLead) targetLeadId = newLead.id;
    }

    /* ---- medical escalation check ---- */
    if (medical_conditions && medical_conditions.trim()) {
      const escalation = checkEscalation(medical_conditions, {
        phone,
        name,
        lead_id: targetLeadId,
      });
      if (escalation.escalate) {
        console.warn(
          `ESCALATION [${escalation.type}] intake form - phone=${maskPhone(phone)} keywords=${escalation.keywords.join(",")}`
        );
        // Flag the lead for manual review
        if (targetLeadId) {
          await supabase
            .from("leads")
            .update({ status: "qualified" })
            .eq("id", targetLeadId);
        }
      }
    }

    /* ---- send confirmation WhatsApp ---- */
    await sendText(
      phone,
      `Thanks ${name}! We've received your intake form. ` +
        `Maddy will review your details and get back to you with a personalized plan recommendation. ` +
        `In the meantime, if you have any questions, just reply here!`
    );

    return res.status(200).json({ success: true, lead_id: targetLeadId });
  } catch (err) {
    console.error("lead-intake error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
