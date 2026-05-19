const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { password } = req.body || {};

    if (!password || !ADMIN_PASSWORD) {
      return res.status(200).json({ valid: false });
    }

    const valid = password === ADMIN_PASSWORD;
    return res.status(200).json({ valid });
  } catch (err) {
    console.error("[admin/verify] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
