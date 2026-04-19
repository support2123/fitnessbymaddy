const { getSupabase } = require("../lib/supabase");
const { cors } = require("../lib/utils");
const { escalateToMaddy } = require("../lib/escalation");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: "client_id and week_no required" });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .eq("status", "active")
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: "Active client not found" });
    }

    let photosUrls = [];
    if (photos && photos.length > 0) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (photo.startsWith("data:")) {
          const matches = photo.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const ext = mimeType.split("/")[1] || "jpg";
            const buffer = Buffer.from(matches[2], "base64");
            const path = `${client_id}/checkin_w${week_no}_${i}.${ext}`;

            const { data: upload } = await db.storage
              .from("clients")
              .upload(path, buffer, { contentType: mimeType, upsert: true });

            if (upload) {
              const { data: urlData } = db.storage
                .from("clients")
                .getPublicUrl(path);
              photosUrls.push(urlData.publicUrl);
            }
          }
        } else {
          photosUrls.push(photo);
        }
      }
    }

    const { data: checkin } = await db
      .from("checkins")
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photosUrls,
      })
      .select()
      .single();

    if (issues && issues.length > 10) {
      const lowerIssues = issues.toLowerCase();
      const dangerSignals = ["pain", "dizzy", "faint", "vomit", "binge", "purge", "can't eat"];
      if (dangerSignals.some((s) => lowerIssues.includes(s))) {
        await escalateToMaddy("Client reported health concern in check-in", {
          client_id,
          week_no,
          issues: issues.slice(0, 300),
        });
      }
    }

    const { count: missedCount } = await db
      .from("checkins")
      .select("*", { count: "exact", head: true })
      .eq("client_id", client_id);

    const expectedWeeks = parseInt(week_no);
    if (expectedWeeks - (missedCount || 0) >= 2) {
      await escalateToMaddy("2+ consecutive missed check-ins", {
        client_id,
        current_week: week_no,
        total_checkins: missedCount,
      });
    }

    if (client.program === "12wk") {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error("Program generation trigger failed:", genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error("checkin-submit error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
