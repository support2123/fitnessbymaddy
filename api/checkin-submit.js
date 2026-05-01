const supabase = require("../lib/supabase");
const { maskPhone, isEscalation } = require("../lib/helpers");
const { notifyMaddy } = require("../lib/escalate");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
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

    // --- Validate required fields ---
    if (!client_id) {
      return res.status(400).json({ error: "Missing client_id" });
    }
    if (week_no == null || week_no === "") {
      return res.status(400).json({ error: "Missing week_no" });
    }

    // --- Verify client exists ---
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, program, name")
      .eq("id", client_id)
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const masked = maskPhone(client.phone);
    console.log(`[checkin-submit] Week ${week_no} check-in from ${masked}`);

    // --- Upload photos to Supabase Storage ---
    const photoUrls = [];
    const storagePath = `clients/${client_id}/week_${week_no}`;

    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];

        if (typeof photo === "string" && photo.startsWith("http")) {
          // Already a URL — store as-is
          photoUrls.push(photo);
        } else if (typeof photo === "string" && photo.length > 100) {
          // Assume base64 — upload to Supabase Storage
          const matches = photo.match(/^data:(.+);base64,(.+)$/);
          let contentType = "image/jpeg";
          let base64Data = photo;

          if (matches) {
            contentType = matches[1];
            base64Data = matches[2];
          }

          const buffer = Buffer.from(base64Data, "base64");
          const ext = contentType.split("/")[1] || "jpg";
          const fileName = `${storagePath}/photo_${i + 1}.${ext}`;

          const { error: uploadErr } = await supabase.storage
            .from("clients")
            .upload(fileName, buffer, {
              contentType,
              upsert: true,
            });

          if (uploadErr) {
            console.error(`[checkin-submit] Photo upload error for ${masked}:`, uploadErr.message);
          } else {
            const { data: urlData } = supabase.storage
              .from("clients")
              .getPublicUrl(fileName);
            photoUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    // --- Insert check-in record ---
    const { error: insertErr } = await supabase.from("checkins").insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight != null ? parseFloat(weight) : null,
      waist: waist != null ? parseFloat(waist) : null,
      compliance_score: compliance_score != null ? parseInt(compliance_score, 10) : null,
      energy: energy != null ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photoUrls,
    });

    if (insertErr) {
      console.error(`[checkin-submit] Insert error for ${masked}:`, insertErr.message);
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    // --- Trigger program generation for 12wk clients ---
    if (client.program === "12wk") {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000";

        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) }),
        });

        console.log(`[checkin-submit] Triggered program generation for ${masked} week ${week_no}`);
      } catch (genErr) {
        // Non-blocking: log but don't fail the check-in
        console.error(`[checkin-submit] Program generation trigger failed for ${masked}:`, genErr.message);
      }
    }

    // --- Escalate if issues contain escalation keywords ---
    if (issues && isEscalation(issues)) {
      await notifyMaddy("Escalation keywords in weekly check-in", {
        client_id,
        phone: masked,
        name: client.name || "Unknown",
        week_no,
        issues: issues.slice(0, 300),
      });
      console.log(`[checkin-submit] Escalated issues from ${masked} week ${week_no}`);
    }

    console.log(`[checkin-submit] Saved check-in for ${masked} week ${week_no}`);
    return res.status(200).json({ success: true, photos_uploaded: photoUrls.length });
  } catch (err) {
    console.error("[checkin-submit] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
