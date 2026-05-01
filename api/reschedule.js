const supabase = require("../lib/supabase");
const { sendText } = require("../lib/whatsapp");
const { maskPhone } = require("../lib/helpers");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { client_id, reason, preferred_day, preferred_time, message } =
      req.body || {};

    if (!client_id || !reason || !preferred_day || !preferred_time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, phone, name")
      .eq("id", client_id)
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const masked = maskPhone(client.phone);
    const text = [
      `RESCHEDULE REQUEST`,
      `Client: ${client.name || masked}`,
      `Reason: ${reason}`,
      `Preferred: ${preferred_day}, ${preferred_time}`,
      message ? `Note: ${message}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await sendText(process.env.MADDY_PHONE, text);

    await supabase.from("messages").insert({
      phone: client.phone,
      direction: "in",
      body: text,
      template_name: "reschedule_request",
    });

    console.log(`[reschedule] Request from ${masked}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[reschedule] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
