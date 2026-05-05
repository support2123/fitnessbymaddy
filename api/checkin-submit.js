const { supabase } = require("./_lib/supabase");
const { sendText, notifyMaddy } = require("./_lib/whatsapp");
const { respond, parseBody, corsHeaders, maskPhone, validateFields } = require("./_lib/helpers");

/* ── upload base64 photo to Supabase Storage ── */
async function uploadPhoto(clientId, weekNo, index, base64Data) {
  // Strip data URI prefix if present
  const raw = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  const path = `${clientId}/checkins/week_${weekNo}/photo_${index}.jpg`;

  const { error } = await supabase.storage
    .from("clients")
    .upload(path, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (error) {
    console.error(`Photo upload failed (${path}):`, error.message);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from("clients")
    .getPublicUrl(path);

  return urlData?.publicUrl || null;
}

module.exports = async function handler(req, res) {
  /* CORS preflight */
  if (req.method === "OPTIONS") {
    const headers = corsHeaders();
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return respond(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await parseBody(req);

    /* ── 1. Validate required fields ── */
    const missing = validateFields(body, ["client_id", "week_no"]);
    if (missing.length > 0) {
      return respond(res, 400, {
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const {
      client_id,
      week_no,
      weight,
      waist,
      issues,
      photos,
    } = body;
    const compliance_score = body.compliance_score || body.training_compliance;
    const energy = body.energy || body.energy_level;

    /* ── 2. Verify client exists and is active ── */
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, name, program, status")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return respond(res, 404, { error: "Client not found" });
    }

    if (client.status !== "active") {
      return respond(res, 400, {
        error: "Client program is not active",
      });
    }

    /* ── 3. Upload photos if provided ── */
    let photosUrls = [];
    if (Array.isArray(photos) && photos.length > 0) {
      const uploadPromises = photos.map((photo, index) => {
        // If already a URL, keep as-is
        if (typeof photo === "string" && photo.startsWith("http")) {
          return Promise.resolve(photo);
        }
        // Otherwise treat as base64
        return uploadPhoto(client_id, week_no, index, photo);
      });

      const results = await Promise.all(uploadPromises);
      photosUrls = results.filter(Boolean);
    }

    /* ── 4. Insert check-in record ── */
    const { data: checkin, error: insertErr } = await supabase
      .from("checkins")
      .insert({
        client_id,
        week_no,
        form_submitted_at: new Date().toISOString(),
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photosUrls.length > 0 ? photosUrls : null,
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Check-in insert failed:", insertErr.message);
      return respond(res, 500, { error: "Failed to save check-in" });
    }

    console.log(
      `Check-in saved: client ${maskPhone(client.phone)} week ${week_no}`
    );

    /* ── 5. For 12-week program: trigger program generation ── */
    if (client.program === "12wk") {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

      fetch(`${baseUrl}/api/generate-program`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id, week_no }),
      }).catch((err) =>
        console.error("generate-program trigger failed:", err.message)
      );
    }

    /* ── 6. Send WhatsApp confirmation to client ── */
    await sendText(
      client.phone,
      "Check-in received! Your updated program will be sent shortly.",
      { isClient: true }
    );

    /* ── Notify Maddy ── */
    await notifyMaddy(
      `Check-in received:\nClient: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nWeight: ${weight || "N/A"}\nCompliance: ${compliance_score || "N/A"}/10`
    );

    /* ── 7. Return success ── */
    return respond(res, 200, {
      ok: true,
      checkin_id: checkin.id,
      photos_uploaded: photosUrls.length,
    });
  } catch (err) {
    console.error("Check-in submit error:", err);
    return respond(res, 500, { error: "Internal server error" });
  }
};
