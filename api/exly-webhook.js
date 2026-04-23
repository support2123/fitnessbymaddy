const crypto = require("crypto");
const { supabase } = require("./_lib/supabase");
const { sendTemplate, logMessage } = require("./_lib/whatsapp");

/**
 * Map a product name to a program type.
 */
function mapProductToProgram(productName) {
  const name = (productName || "").toLowerCase();

  if (name.includes("6 week") || name.includes("shred") || name.includes("burn")) {
    return "6wk_gym";
  }
  if (name.includes("pcos")) {
    return "pcos";
  }
  if (name.includes("40+") || name.includes("40 plus")) {
    return "40plus";
  }
  if (name.includes("12 week") || name.includes("custom") || name.includes("flagship")) {
    return "12wk";
  }
  if (name.includes("trial") || name.includes("zoom")) {
    return "zoom_trial";
  }

  return "6wk_gym";
}

/**
 * Get program duration in days based on program type.
 */
function getProgramDurationDays(program) {
  switch (program) {
    case "6wk_gym":
    case "pcos":
    case "40plus":
      return 42;
    case "12wk":
      return 84;
    case "zoom_trial":
      return 7;
    default:
      return 42;
  }
}

/**
 * Timing-safe comparison of two strings.
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    // Compare against itself to keep constant time, then return false
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1. Verify webhook secret
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  const headerSecret = req.headers["x-webhook-secret"] || "";

  if (!secret || !timingSafeEqual(headerSecret, secret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 2. Parse body
    const { phone, name, email, amount, checkout_id, product_name } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: "Missing phone" });
    }

    // 3. Map product to program type
    const program = mapProductToProgram(product_name);

    // 4. Calculate program end date
    const durationDays = getProgramDurationDays(program);
    const programEndsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // 5. Find or create lead
    let { data: lead, error: leadFetchErr } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (leadFetchErr) {
      console.error(`[exly-webhook] Error fetching lead: ${leadFetchErr.message}`);
    }

    if (!lead) {
      const { data: newLead, error: leadCreateErr } = await supabase
        .from("leads")
        .insert({ phone, name: name || null, email: email || null })
        .select("id")
        .single();

      if (leadCreateErr) {
        console.error(`[exly-webhook] Error creating lead: ${leadCreateErr.message}`);
        return res.status(500).json({ error: "Failed to create lead" });
      }
      lead = newLead;
    }

    // Insert into clients table
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .insert({
        lead_id: lead.id,
        phone,
        name: name || null,
        email: email || null,
        program,
        amount: amount || null,
        checkout_id: checkout_id || null,
        status: "active",
        program_ends_at: programEndsAt,
      })
      .select("id")
      .single();

    if (clientErr) {
      console.error(`[exly-webhook] Error creating client: ${clientErr.message}`);
      return res.status(500).json({ error: "Failed to create client" });
    }

    // 6. Update lead status to converted
    const { error: leadUpdateErr } = await supabase
      .from("leads")
      .update({ status: "converted" })
      .eq("id", lead.id);

    if (leadUpdateErr) {
      console.error(`[exly-webhook] Error updating lead status: ${leadUpdateErr.message}`);
    }

    // 7. Create Supabase Storage folder path
    const folderPath = `clients/${client.id}/`;

    // Upload a placeholder to ensure the folder exists in Storage
    await supabase.storage
      .from("files")
      .upload(`${folderPath}.keep`, Buffer.from(""), {
        contentType: "text/plain",
        upsert: true,
      });

    // 8. Send onboarding WhatsApp template
    const templateName = `onboard_${program}`;
    try {
      await sendTemplate(phone, templateName, [name || "there"]);
      await logMessage(phone, "outbound", `[template: ${templateName}]`, templateName);
    } catch (err) {
      console.error(`[exly-webhook] WhatsApp onboarding send failed: ${err.message}`);
    }

    // 9. Send confirmation email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        const programLabel = program.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const emailBody = [
          `Hi ${name || "there"},`,
          "",
          `Welcome to FitnessByMaddy! We're excited to have you on board.`,
          "",
          `Your ${programLabel} program starts now. You'll receive your workout plan and check-in details on WhatsApp shortly.`,
          "",
          `If you have any questions, just reply to this email or message us on WhatsApp.`,
          "",
          `Let's crush it!`,
          `- Team FitnessByMaddy`,
        ].join("\n");

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: "support@fitnessbymaddy.com",
            to: email,
            subject: `Welcome to FitnessByMaddy! Your ${programLabel} starts now`,
            text: emailBody,
          }),
        });
      } catch (err) {
        console.error(`[exly-webhook] Email send failed: ${err.message}`);
      }
    } else {
      console.warn("[exly-webhook] RESEND_API_KEY not set — skipping confirmation email");
    }

    // 10. Return 200
    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
      program_ends_at: programEndsAt,
    });
  } catch (err) {
    console.error(`[exly-webhook] Error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
