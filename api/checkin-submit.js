const { getSupabase } = require("./lib/supabase");
const { needsEscalation, escalateToMaddy } = require("./lib/escalation");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const db = getSupabase();

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
      mood,
      sleep_quality,
      notes,
    } = req.body;

    if (!client_id || !week_no) {
      return res
        .status(400)
        .json({ error: "client_id and week_no required" });
    }

    const { data: client } = await db
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    let photoUrls = [];
    if (photos && Array.isArray(photos)) {
      for (const photo of photos) {
        if (photo.base64 && photo.filename) {
          const buffer = Buffer.from(photo.base64, "base64");
          const path = `clients/${client_id}/checkin_w${week_no}_${photo.filename}`;
          const { error: uploadErr } = await db.storage
            .from("client-files")
            .upload(path, buffer, {
              contentType: photo.type || "image/jpeg",
              upsert: true,
            });
          if (!uploadErr) {
            const { data: urlData } = db.storage
              .from("client-files")
              .getPublicUrl(path);
            photoUrls.push(urlData.publicUrl);
          }
        }
      }
    }

    const allIssues = [issues, notes].filter(Boolean).join(" ");
    if (needsEscalation(allIssues)) {
      await escalateToMaddy(
        "Check-in concern",
        client.phone,
        allIssues.slice(0, 300)
      );
    }

    const { data: checkin, error } = await db
      .from("checkins")
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        form_submitted_at: new Date().toISOString(),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score
          ? parseInt(compliance_score, 10)
          : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photoUrls.length > 0 ? photoUrls : null,
        next_week_focus: null,
      })
      .select()
      .single();

    if (error) {
      console.error("[CHECKIN]", error.message);
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    if (client.program === "12wk") {
      try {
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "https://fitnessbymaddy.com";

        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no, 10) + 1,
          }),
        });
      } catch (genErr) {
        console.error("[CHECKIN] Program gen trigger failed:", genErr.message);
      }
    }

    return res.json({
      ok: true,
      message: "Check-in submitted successfully",
      checkin_id: checkin.id,
    });
  } catch (err) {
    console.error("[CHECKIN ERROR]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
