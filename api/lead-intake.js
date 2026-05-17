const { getSupabase } = require("./_lib/supabase");
const { sendTextMessage } = require("./_lib/whatsapp");

/**
 * POST /api/lead-intake
 *
 * Receives the intake-form submission for a new or existing client.
 * Updates the lead record, stores the full form data as a message, and
 * sends a confirmation WhatsApp.
 */
module.exports = async function handler(req, res) {
  // ── CORS headers ─────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    lead_id,
    name,
    age,
    gender,
    goal,
    injuries,
    diet_preference,
    schedule,
    current_weight,
    height,
    medical_conditions,
    phone,
    email,
  } = req.body || {};

  console.log(
    `[lead-intake] Received intake form: lead_id=${lead_id}, phone=${phone}, name=${name}`
  );

  const supabase = getSupabase();

  try {
    // ── Update the lead record ───────────────────────────────────
    if (lead_id) {
      const { error: leadErr } = await supabase
        .from("leads")
        .update({ name })
        .eq("id", lead_id);

      if (leadErr) {
        console.error(
          "[lead-intake] Error updating lead by id:",
          leadErr.message
        );
      } else {
        console.log(`[lead-intake] Lead ${lead_id} updated with name`);
      }
    } else if (phone) {
      // Fall back to matching by phone if no lead_id provided
      const { error: leadErr } = await supabase
        .from("leads")
        .update({ name })
        .eq("phone", phone);

      if (leadErr) {
        console.error(
          "[lead-intake] Error updating lead by phone:",
          leadErr.message
        );
      }
    }

    // ── Upsert client record ─────────────────────────────────────
    // Try to find an existing client by lead_id or phone
    let clientId = null;

    if (lead_id) {
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("lead_id", lead_id)
        .maybeSingle();

      if (existing) clientId = existing.id;
    }

    if (!clientId && phone) {
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();

      if (existing) clientId = existing.id;
    }

    if (clientId) {
      // Update existing client with name/email if provided
      const updates = {};
      if (name) updates.name = name;
      if (email) updates.email = email;

      if (Object.keys(updates).length > 0) {
        const { error: updateErr } = await supabase
          .from("clients")
          .update(updates)
          .eq("id", clientId);

        if (updateErr) {
          console.error(
            "[lead-intake] Error updating client:",
            updateErr.message
          );
        } else {
          console.log(`[lead-intake] Client ${clientId} updated`);
        }
      }
    }

    // ── Store intake form data as a message ──────────────────────
    const intakeData = {
      name,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_weight,
      height,
      medical_conditions,
      phone,
      email,
    };

    const messagePhone = phone || null;

    const { error: msgErr } = await supabase.from("messages").insert({
      phone: messagePhone,
      direction: "in",
      body: JSON.stringify(intakeData),
      template_name: "intake_form",
      sent_at: new Date().toISOString(),
      status: "received",
    });

    if (msgErr) {
      console.error(
        "[lead-intake] Error storing intake form data:",
        msgErr.message
      );
    } else {
      console.log("[lead-intake] Intake form data stored in messages table");
    }

    // ── Send confirmation WhatsApp ───────────────────────────────
    if (phone) {
      try {
        const displayName = name || "there";
        await sendTextMessage(
          phone,
          `Thanks ${displayName}! We've received your details. Your coach will review everything and your program will be ready soon 💪`
        );
        console.log(`[lead-intake] Confirmation WhatsApp sent to ${phone}`);
      } catch (waErr) {
        console.error(
          "[lead-intake] Failed to send confirmation WhatsApp:",
          waErr.message
        );
        // Non-fatal — form data is already saved
      }
    }

    return res.status(200).json({ status: "received" });
  } catch (err) {
    console.error("[lead-intake] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
