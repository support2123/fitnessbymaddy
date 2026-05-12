// api/lead-intake.js  —  Handles POST submissions from the intake form
const { supabase } = require("../lib/supabase");
const { sendTextMessage } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/utils");

const MADDY_PHONE = "+917082478374";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const {
      lead_id,
      name,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
    } = body;

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------
    if (!lead_id) {
      return res.status(400).json({ error: "lead_id is required" });
    }

    // Verify lead exists
    const { data: lead, error: lookupErr } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("id", lead_id)
      .maybeSingle();

    if (lookupErr) throw lookupErr;

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const masked = maskPhone(lead.phone);
    console.log(`lead-intake: processing intake for lead ${lead_id} (${masked})`);

    // ------------------------------------------------------------------
    // Build profile JSONB payload
    // ------------------------------------------------------------------
    const profile = {
      age: age || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    };

    const updatePayload = {
      profile,
      status: "intake_done",
    };

    if (name) {
      updatePayload.name = name;
    }

    const { error: updateErr } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", lead_id);

    if (updateErr) throw updateErr;

    console.log(`lead-intake: updated profile for ${masked}`);

    // ------------------------------------------------------------------
    // Escalate when medical conditions are present
    // ------------------------------------------------------------------
    if (medical_conditions && medical_conditions.trim().length > 0) {
      console.log(`lead-intake: medical conditions flagged for ${masked}`);
      try {
        await sendTextMessage(
          MADDY_PHONE,
          `MEDICAL FLAG for ${masked}: "${medical_conditions.slice(0, 300)}". Please review before onboarding.`
        );
      } catch (err) {
        console.error("lead-intake: failed to notify Maddy about medical conditions:", err.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("lead-intake: error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
