const { supabase } = require("./lib/supabase");
const { sendText } = require("./lib/whatsapp");
const { checkEscalation, maskPhone } = require("./lib/utils");

const MADDY_PHONE = "+917082478374";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://fitnessbymaddy.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

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
    } = req.body || {};

    if (!client_id || week_no == null) {
      return res.status(400).json({ error: "Missing required fields: client_id, week_no" });
    }

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, program, name")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const { error: insertErr } = await supabase.from("checkins").insert({
      client_id,
      week_no,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos || [],
    });

    if (insertErr) {
      console.error("Failed to insert checkin:", insertErr.message);
      return res.status(500).json({ error: "Failed to save check-in" });
    }

    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation.shouldEscalate) {
        await sendText(
          MADDY_PHONE,
          `ESCALATION from ${client.name || "client"} (${client.phone}, week ${week_no}): "${escalation.reason}"\nIssues: ${issues}`
        );
      }
    }

    if (client.program === "12wk") {
      await supabase.from("programs").insert({
        client_id,
        week_no: week_no + 1,
        notes: "pending_generation",
      });
    }

    await sendText(
      client.phone,
      `Thanks for submitting your Week ${week_no} check-in! We'll review it and get back to you soon.`
    );

    return res.status(200).json({ ok: true, message: "Check-in submitted successfully" });
  } catch (err) {
    console.error("checkin-submit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
