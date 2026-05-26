const { supabase } = require("./_lib/supabase");
const { sendText } = require("./_lib/whatsapp");

function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  corsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
    } = req.body || {};

    // --- validation ---
    if (!client_id || !week_no) {
      return res
        .status(400)
        .json({ error: "client_id and week_no are required" });
    }

    if (
      compliance_score !== undefined &&
      (compliance_score < 1 || compliance_score > 10)
    ) {
      return res
        .status(400)
        .json({ error: "compliance_score must be between 1 and 10" });
    }

    if (energy !== undefined && (energy < 1 || energy > 10)) {
      return res
        .status(400)
        .json({ error: "energy must be between 1 and 10" });
    }

    // --- verify client exists and is active ---
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, status, program_type")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.status !== "active") {
      return res.status(400).json({ error: "Client is not active" });
    }

    // --- upload photos if base64 ---
    const photoUrls = [];

    if (Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const storagePath = `clients/${client_id}/checkin_w${week_no}/photo_${i + 1}.jpg`;

        if (photo.startsWith("data:") || photo.startsWith("/9j/") || photo.startsWith("iVBOR")) {
          // base64 image — strip data URI prefix if present
          let base64Data = photo;
          let contentType = "image/jpeg";

          if (photo.startsWith("data:")) {
            const match = photo.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              contentType = match[1];
              base64Data = match[2];
            }
          }

          const buffer = Buffer.from(base64Data, "base64");

          const { error: uploadErr } = await supabase.storage
            .from("checkin-photos")
            .upload(storagePath, buffer, {
              contentType,
              upsert: true,
            });

          if (uploadErr) {
            console.error("Photo upload error:", uploadErr.message);
            continue;
          }

          const { data: urlData } = supabase.storage
            .from("checkin-photos")
            .getPublicUrl(storagePath);

          photoUrls.push(urlData.publicUrl);
        } else {
          // assume it's already a URL
          photoUrls.push(photo);
        }
      }
    }

    // --- insert check-in ---
    const { data: checkin, error: insertErr } = await supabase
      .from("checkins")
      .insert({
        client_id,
        week_no,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos: photoUrls.length > 0 ? photoUrls : null,
        submitted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("Check-in insert error:", insertErr.message);
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    // --- send confirmation WhatsApp ---
    try {
      await sendText(
        client.phone,
        `Week ${week_no} check-in received! Your updated program will be ready within 24 hours.`
      );
    } catch (whatsappErr) {
      console.error("WhatsApp confirmation failed:", whatsappErr.message);
      // non-blocking — check-in is already saved
    }

    // --- trigger program generation for 12-week clients ---
    if (client.program_type === "12_week") {
      try {
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000";

        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id, week_no }),
        });
      } catch (genErr) {
        console.error("Program generation trigger failed:", genErr.message);
        // non-blocking — can be retried manually
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error("checkin-submit error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
