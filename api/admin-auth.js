const { getSupabase } = require("./lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const db = getSupabase();
    const { email, password } = req.body;

    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    return res.status(200).json({
      success: true,
      token: data.session.access_token,
    });
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
