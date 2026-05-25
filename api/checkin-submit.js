const { getSupabase } = require("./_lib/supabase");
const { checkEscalation, notifyMaddy } = require("./_lib/escalation");

// ---- CORS headers ----
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = body;

    if (!client_id) {
      return res.status(400).json({ error: "client_id is required" });
    }

    const supabase = getSupabase();

    // ---- Verify client exists and is active ----
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, program, phone, status")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.status !== "active") {
      return res.status(400).json({ error: "Client is not active" });
    }

    // ---- Insert check-in ----
    const { error: insertErr } = await supabase.from("checkins").insert({
      client_id,
      week_no: week_no || null,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos_urls || null,
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error("[checkin] Failed to insert:", insertErr.message);
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    // ---- Check issues for escalation keywords ----
    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation.shouldEscalate) {
        await notifyMaddy(escalation.reason, {
          phone: client.phone,
          message: `Check-in issue (week ${week_no || "?"}): ${issues}`,
          leadId: client_id,
        });
      }
    }

    // ---- If 12wk program, trigger program generation ----
    if (client.program === "12wk") {
      const baseUrl =
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "https://fitnessbymaddy.com";

      try {
        fetch(`${baseUrl}/api/generate-program`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id,
            week_no: week_no || null,
          }),
        }).catch((err) => {
          // Fire-and-forget — log but don't fail the check-in
          console.error("[checkin] generate-program call failed:", err.message);
        });
      } catch (err) {
        console.error("[checkin] generate-program trigger failed:", err.message);
      }
    }

    console.log(`[checkin] Check-in saved for client ${client_id} (week ${week_no || "?"})`);
    return res.status(200).json({ success: true, message: "Check-in received!" });
  } catch (err) {
    console.error("[checkin] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
