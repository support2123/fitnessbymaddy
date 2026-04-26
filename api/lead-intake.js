const { supabase } = require("./lib/supabase");

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
    const body = req.body || {};
    const lead_id = body.lead_id;
    const name = body.name || body.full_name;
    const email = body.email;
    const phone = body.phone;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: "Missing required fields: lead_id, name, phone" });
    }

    const { error: leadErr } = await supabase
      .from("leads")
      .update({ name })
      .eq("id", lead_id);

    if (leadErr) {
      console.error("Failed to update lead:", leadErr.message);
      return res.status(500).json({ error: "Failed to update lead" });
    }

    const { data: existingClient } = await supabase
      .from("clients")
      .select("id")
      .eq("lead_id", lead_id)
      .single();

    if (existingClient) {
      const { error: clientErr } = await supabase
        .from("clients")
        .update({
          name,
          email: email || undefined,
          phone,
        })
        .eq("id", existingClient.id);

      if (clientErr) {
        console.error("Failed to update client:", clientErr.message);
        return res.status(500).json({ error: "Failed to update client" });
      }
    }

    return res.status(200).json({ ok: true, message: "Intake form submitted successfully" });
  } catch (err) {
    console.error("lead-intake error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
