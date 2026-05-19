const { supabase } = require("../lib/supabase");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const client_id = body.client_id;
    const week_no = body.week_no || body.week_number;
    const weight = body.weight;
    const waist = body.waist;
    const compliance_score = body.compliance_score;
    const energy = body.energy || body.energy_level;
    const issues = body.issues || body.challenges;
    const wins = body.wins;
    const photos = body.photos || body.photos_urls;

    if (!client_id) {
      return res.status(400).json({ error: "Missing client_id" });
    }

    if (!week_no) {
      return res.status(400).json({ error: "Missing week_no" });
    }

    // ── Validate client exists and is active ──────────────────────
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, program, status")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.status !== "active") {
      return res.status(400).json({ error: "Client is not active" });
    }

    // ── Insert check-in record ────────────────────────────────────
    const { data: checkin, error: insertError } = await supabase
      .from("checkins")
      .insert({
        client_id,
        week_no,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos: photos || null,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        `[checkin-submit] Failed to insert check-in for client ${client_id}: ${insertError.message}`
      );
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    return res.status(200).json({
      success: true,
      checkin_id: checkin.id,
      message: "Check-in submitted successfully! Your coach will review it shortly.",
    });
  } catch (err) {
    console.error(`[checkin-submit] Unhandled error: ${err.message}`);
    return res.status(500).json({ error: "Internal server error" });
  }
};
