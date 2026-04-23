const { supabase } = require("./_lib/supabase");
const { sendText, logMessage } = require("./_lib/whatsapp");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

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

    // Validate required fields
    if (!client_id || week_no === undefined || week_no === null) {
      return res.status(400).json({
        error: "Missing required fields: client_id and week_no are required",
      });
    }

    // Process photos — upload base64 strings to Supabase Storage
    const photoUrls = [];

    if (photos && Array.isArray(photos)) {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];

        // If it's already a URL, keep it as-is
        if (typeof photo === "string" && photo.startsWith("http")) {
          photoUrls.push(photo);
          continue;
        }

        // Assume base64 string — upload to Supabase Storage
        if (typeof photo === "string" && photo.length > 0) {
          const filePath = `clients/${client_id}/week_${week_no}_photo_${i}.jpg`;

          // Decode base64 to buffer
          const base64Data = photo.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");

          const { error: uploadError } = await supabase.storage
            .from("checkin-photos")
            .upload(filePath, buffer, {
              contentType: "image/jpeg",
              upsert: true,
            });

          if (uploadError) {
            console.error(`[checkin-submit] Photo upload error: ${uploadError.message}`);
            // Continue without failing the whole request
          } else {
            const { data: publicUrlData } = supabase.storage
              .from("checkin-photos")
              .getPublicUrl(filePath);

            if (publicUrlData?.publicUrl) {
              photoUrls.push(publicUrlData.publicUrl);
            }
          }
        }
      }
    }

    // Insert into checkins table
    const { error: insertError } = await supabase.from("checkins").insert({
      client_id,
      week_no,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photoUrls.length > 0 ? photoUrls : null,
      form_submitted_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error(`[checkin-submit] Error inserting checkin: ${insertError.message}`);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Check if client is on 12wk program — insert pending program generation marker
    const { data: client } = await supabase
      .from("clients")
      .select("id, phone, program")
      .eq("id", client_id)
      .maybeSingle();

    if (client && client.program === "12wk") {
      const { error: programError } = await supabase.from("programs").insert({
        client_id,
        week_no: week_no + 1,
        generated_at: null,
      });

      if (programError) {
        console.error(
          `[checkin-submit] Error inserting pending program: ${programError.message}`
        );
      } else {
        console.log(
          `[checkin-submit] Pending program generation queued for client ${client_id} week ${week_no + 1}`
        );
      }
    }

    // Check for escalation keywords in issues
    if (issues) {
      const issueCheck = checkEscalation(issues);
      if (issueCheck.shouldEscalate) {
        await notifyMaddy(issueCheck.reason, {
          phone: client?.phone || "unknown",
          message: `Check-in week ${week_no} issues: ${issues}`,
        });
      }
    }

    // Send confirmation WhatsApp
    if (client?.phone) {
      try {
        const confirmMsg = `Check-in received! Week ${week_no} data logged.`;
        await sendText(client.phone, confirmMsg);
        await logMessage(client.phone, "outbound", confirmMsg, null);
      } catch (whatsappErr) {
        console.error(`[checkin-submit] WhatsApp confirmation failed: ${whatsappErr.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Check-in for week ${week_no} submitted successfully`,
    });
  } catch (err) {
    console.error(`[checkin-submit] Error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
