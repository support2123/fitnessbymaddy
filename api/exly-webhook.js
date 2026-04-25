const crypto = require("crypto");
const { getSupabase } = require("../lib/supabase");
const { sendTemplate, sendText } = require("../lib/whatsapp");
const { generateProgram } = require("../lib/program-generator");
const { generatePDF } = require("../lib/pdf-generator");

/* ---------- constants ---------- */

const PROGRAM_SLUG_MAP = {
  "burn-build": "6-Week Burn & Build",
  "burn_build": "6-Week Burn & Build",
  "6-week": "6-Week Burn & Build",
  "6_week": "6-Week Burn & Build",
  "pcos-warrior": "PCOS Warrior",
  "pcos_warrior": "PCOS Warrior",
  pcos: "PCOS Warrior",
  "40-strong": "40+ Strong",
  "40_strong": "40+ Strong",
  "40plus": "40+ Strong",
  "12-week-flagship": "12-Week Flagship",
  "12_week_flagship": "12-Week Flagship",
  "12-week": "12-Week Flagship",
  flagship: "12-Week Flagship",
  "zoom-trial": "Zoom Trial",
  "zoom_trial": "Zoom Trial",
  zoom: "Zoom Trial",
  trial: "Zoom Trial",
};

const PROGRAM_DURATIONS = {
  "6-Week Burn & Build": 42,
  "PCOS Warrior": 42,
  "40+ Strong": 42,
  "12-Week Flagship": 84,
  "Zoom Trial": 7,
};

/* ---------- helpers ---------- */

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-2);
}

function maskPII(text) {
  if (!text) return text;
  return text
    .replace(/\+?\d{10,15}/g, "***PHONE***")
    .replace(/[\w.-]+@[\w.-]+/g, "***EMAIL***");
}

function normalizeProgram(rawName) {
  if (!rawName) return "12-Week Flagship";
  const lower = rawName.toLowerCase().trim();

  // Direct match in slug map
  for (const [key, value] of Object.entries(PROGRAM_SLUG_MAP)) {
    if (lower.includes(key)) return value;
  }

  // Keyword fallback
  if (lower.includes("burn") || lower.includes("shred")) return "6-Week Burn & Build";
  if (lower.includes("pcos") || lower.includes("hormonal")) return "PCOS Warrior";
  if (lower.includes("40") || lower.includes("menopause")) return "40+ Strong";
  if (lower.includes("zoom") || lower.includes("trial")) return "Zoom Trial";

  return "12-Week Flagship";
}

function programToTemplateSlug(program) {
  const map = {
    "6-Week Burn & Build": "burn_build",
    "PCOS Warrior": "pcos_warrior",
    "40+ Strong": "40_strong",
    "12-Week Flagship": "12_week_flagship",
    "Zoom Trial": "zoom_trial",
  };
  return map[program] || "12_week_flagship";
}

function verifySignature(rawBody, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("EXLY_WEBHOOK_SECRET not set - skipping signature verification");
    return true;
  }
  if (!signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody))
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "utf8"),
    Buffer.from(expected, "utf8")
  );
}

/* ---------- handler ---------- */

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Exly-Signature");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(200).json({ status: "ignored", reason: "method" });
  }

  try {
    /* ---- verify webhook signature ---- */
    const signature =
      req.headers["x-exly-signature"] ||
      req.headers["x-webhook-signature"] ||
      "";

    if (!verifySignature(req.body, signature)) {
      console.warn("Exly webhook: invalid signature");
      return res.status(200).json({ status: "ok", note: "invalid signature" });
    }

    const supabase = getSupabase();
    const body = req.body || {};

    /* ---- extract purchase data ---- */
    // Support various Exly payload shapes
    const customerPhone =
      body.customer_phone ||
      body.phone ||
      (body.customer && body.customer.phone) ||
      "";
    const customerName =
      body.customer_name ||
      body.name ||
      (body.customer && body.customer.name) ||
      "";
    const customerEmail =
      body.customer_email ||
      body.email ||
      (body.customer && body.customer.email) ||
      "";
    const rawProgram =
      body.product_name ||
      body.program ||
      (body.product && body.product.name) ||
      "";
    const paidAmount =
      body.amount ||
      body.paid_amount ||
      (body.payment && body.payment.amount) ||
      0;
    const checkoutId =
      body.checkout_id ||
      body.order_id ||
      body.transaction_id ||
      "";

    if (!customerPhone) {
      console.warn("Exly webhook: no phone number in payload");
      return res.status(200).json({ status: "ok", note: "no phone" });
    }

    const program = normalizeProgram(rawProgram);
    const templateSlug = programToTemplateSlug(program);
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    /* ---- find matching lead ---- */
    const { data: leadRows } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", customerPhone)
      .limit(1);

    let leadId = null;
    if (leadRows && leadRows.length > 0) {
      leadId = leadRows[0].id;

      // Update lead status to converted
      await supabase
        .from("leads")
        .update({
          status: "converted",
          name: customerName || leadRows[0].name,
          last_msg_at: new Date().toISOString(),
        })
        .eq("id", leadId);
    } else {
      // Create a lead record for tracking
      const { data: newLead } = await supabase
        .from("leads")
        .insert({
          phone: customerPhone,
          name: customerName,
          source: "exly",
          status: "converted",
          program_interest: program,
          last_msg_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (newLead) leadId = newLead.id;
    }

    /* ---- check for duplicate purchase ---- */
    if (checkoutId) {
      const { data: existingClient } = await supabase
        .from("clients")
        .select("id")
        .eq("checkout_id", checkoutId)
        .limit(1);

      if (existingClient && existingClient.length > 0) {
        console.warn(`Exly webhook: duplicate checkout_id ${checkoutId}`);
        return res.status(200).json({ status: "ok", note: "duplicate" });
      }
    }

    /* ---- create client record ---- */
    const now = new Date();
    const programEnds = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const clientRecord = {
      lead_id: leadId,
      phone: customerPhone,
      name: customerName,
      email: customerEmail || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: paidAmount || null,
      checkout_id: checkoutId || null,
      status: "active",
    };

    const { data: newClient, error: clientInsertErr } = await supabase
      .from("clients")
      .insert(clientRecord)
      .select()
      .single();

    if (clientInsertErr) {
      console.error("Client insert failed:", clientInsertErr.message);
      return res.status(200).json({ status: "ok", note: "client insert failed" });
    }

    /* ---- create Supabase Storage folder for client ---- */
    try {
      const placeholderPath = `clients/${newClient.id}/.folder`;
      await supabase.storage
        .from("fitness-files")
        .upload(placeholderPath, Buffer.from(""), {
          contentType: "text/plain",
          upsert: true,
        });

      // Store the folder URL on the client record
      const { data: folderUrlData } = supabase.storage
        .from("fitness-files")
        .getPublicUrl(`clients/${newClient.id}`);

      if (folderUrlData && folderUrlData.publicUrl) {
        await supabase
          .from("clients")
          .update({ folder_url: folderUrlData.publicUrl })
          .eq("id", newClient.id);
      }
    } catch (storageErr) {
      console.error("Storage folder creation failed:", storageErr.message);
      // Non-fatal - continue onboarding
    }

    /* ---- send onboarding WhatsApp template ---- */
    const templateName = `onboard_${templateSlug}`;
    await sendTemplate(customerPhone, templateName, {
      name: customerName || "there",
      program,
    }).catch((err) => {
      console.error(`Onboarding template send failed for ${maskPhone(customerPhone)}:`, err.message);
    });

    /* ---- for 12-week program: trigger Week-1 program generation ---- */
    if (program === "12-Week Flagship") {
      try {
        const clientForGen = {
          ...newClient,
          goal: (leadRows && leadRows[0] && leadRows[0].program_interest) || "general fitness",
          fitness_level: "beginner",
        };

        const result = await generateProgram(clientForGen, []);

        if (result.flagged) {
          // Log flagged program but don't block onboarding
          await supabase.from("programs").insert({
            client_id: newClient.id,
            week_no: 1,
            generated_at: new Date().toISOString(),
            workout_plan: result.plan.workout_plan || null,
            nutrition_plan: result.plan.nutrition_plan || null,
            notes: `FLAGGED: ${result.flagReason}`,
          });

          console.warn(
            `Week-1 program flagged for client ${newClient.id}: ${result.flagReason}`
          );
        } else {
          // Generate PDF
          const pdfBuffer = await generatePDF(clientForGen, 1, result.plan);

          // Upload PDF
          const pdfPath = `clients/${newClient.id}/week_1.pdf`;
          const { error: uploadErr } = await supabase.storage
            .from("fitness-files")
            .upload(pdfPath, pdfBuffer, {
              contentType: "application/pdf",
              upsert: true,
            });

          let pdfUrl = null;
          if (!uploadErr) {
            const { data: urlData } = supabase.storage
              .from("fitness-files")
              .getPublicUrl(pdfPath);
            pdfUrl = urlData ? urlData.publicUrl : null;
          } else {
            console.error("Week-1 PDF upload failed:", uploadErr.message);
          }

          // Insert program record
          const genNow = new Date().toISOString();
          await supabase.from("programs").insert({
            client_id: newClient.id,
            week_no: 1,
            generated_at: genNow,
            pdf_url: pdfUrl,
            whatsapp_sent_at: pdfUrl ? genNow : null,
            workout_plan: result.plan.workout_plan || null,
            nutrition_plan: result.plan.nutrition_plan || null,
            notes: "Week 1 - Onboarding program",
          });

          // Send PDF link via WhatsApp
          if (pdfUrl) {
            await sendText(
              customerPhone,
              `Your Week 1 program is ready! Download it here: ${pdfUrl}\n\nLet's get started!`
            ).catch((err) =>
              console.error("Week-1 PDF WhatsApp send failed:", err.message)
            );
          }
        }
      } catch (genErr) {
        console.error("Week-1 program generation failed:", maskPII(genErr.message));
        // Non-fatal - client is still onboarded
      }
    }

    return res.status(200).json({ status: "ok", client_id: newClient.id });
  } catch (err) {
    console.error("exly-webhook error:", maskPII(err.message));
    // Always return 200 for webhooks
    return res.status(200).json({ status: "ok", note: "internal error logged" });
  }
};
