const { query, update } = require("./lib/supabase");
const { sendTemplate, maskPhone } = require("./lib/whatsapp");
const { needsEscalation, corsHeaders, jsonResponse, errorResponse } = require("./lib/utils");

const MADDY_PHONE = process.env.MADDY_PHONE || "+917082478374";

const REQUIRED_FIELDS = ["name", "phone"];

/**
 * Validate that required fields are present and non-empty.
 * Returns an array of missing field names, or empty array if valid.
 */
function validateFields(body) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || String(body[field]).trim() === "") {
      missing.push(field);
    }
  }
  return missing;
}

module.exports = async function handler(req, res) {
  // ---------- CORS preflight ----------
  if (req.method === "OPTIONS") {
    const cors = corsHeaders();
    for (const [k, v] of Object.entries(cors)) {
      res.setHeader(k, v);
    }
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return errorResponse(res, "Method not allowed", 405);
  }

  let phone;

  try {
    const body = req.body || {};

    // ---------- Validate required fields ----------
    const missing = validateFields(body);
    if (missing.length > 0) {
      return errorResponse(res, `Missing required fields: ${missing.join(", ")}`, 400);
    }

    phone = body.phone;
    if (!phone.startsWith("+")) {
      phone = `+${phone}`;
    }

    const name = body.name || body.full_name;
    const email = body.email;
    const age = body.age;
    const goal = body.goal || body.primary_goal;
    const injuries = body.injuries;
    const diet_pref = body.diet_pref || body.dietary_preference;
    const schedule = body.schedule || body.available_days;
    const current_fitness = body.current_fitness || body.fitness_level;
    const medical_conditions = body.medical_conditions;

    // ---------- Find existing lead ----------
    const leads = await query("leads", {
      filters: { phone: `eq.${phone}` },
      limit: 1,
    });

    if (!leads || leads.length === 0) {
      return errorResponse(res, "No lead found for this phone number. Please start a conversation on WhatsApp first.", 404);
    }

    // ---------- Build profile object ----------
    const profile = {
      age: age || null,
      gender: body.gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      food_allergies: body.food_allergies || null,
      schedule: schedule || null,
      training_location: body.training_location || null,
      current_fitness: current_fitness || null,
      medical_conditions: medical_conditions || null,
      current_weight: body.current_weight || null,
      height: body.height || null,
      additional_notes: body.additional_notes || null,
    };

    // ---------- Update lead record ----------
    const updateData = {
      name: name || leads[0].name,
      email: email || leads[0].email || null,
      profile,
      intake_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await update("leads", { phone: `eq.${phone}` }, updateData);

    console.log(`[lead-intake] Intake form saved for ${maskPhone(phone)}`);

    // ---------- Medical conditions escalation ----------
    if (medical_conditions && String(medical_conditions).trim() !== "") {
      try {
        await sendTemplate(MADDY_PHONE, "escalation_alert", [
          maskPhone(phone),
          `Medical conditions reported: ${String(medical_conditions).slice(0, 200)}`,
        ]);
        console.log(`[lead-intake] Medical escalation sent for ${maskPhone(phone)}`);
      } catch (escErr) {
        console.error(`[lead-intake] Escalation send failed for ${maskPhone(phone)}: ${escErr.message}`);
      }
    }

    // Also escalate if any field content triggers keyword-based escalation
    const allText = [goal, injuries, medical_conditions, current_fitness]
      .filter(Boolean)
      .join(" ");

    if (needsEscalation(allText)) {
      try {
        await sendTemplate(MADDY_PHONE, "escalation_alert", [
          maskPhone(phone),
          `Intake form flagged: ${allText.slice(0, 200)}`,
        ]);
        console.log(`[lead-intake] Keyword escalation sent for ${maskPhone(phone)}`);
      } catch (escErr) {
        console.error(`[lead-intake] Keyword escalation send failed: ${escErr.message}`);
      }
    }

    return jsonResponse(res, {
      status: "ok",
      message: "Intake form saved successfully",
    });

  } catch (err) {
    const safePhone = phone ? maskPhone(phone) : "unknown";
    console.error(`[lead-intake] Error for ${safePhone}: ${err.message}`);
    return errorResponse(res, "Internal server error", 500);
  }
}
