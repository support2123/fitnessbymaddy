module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { password } = req.body || {};

    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      console.error("[admin-auth] ADMIN_PASSWORD env var is not set");
      return res.status(500).json({ error: "Server configuration error" });
    }

    if (password === adminPassword) {
      console.log("[admin-auth] Successful authentication");
      return res.status(200).json({ token: "valid" });
    }

    console.log("[admin-auth] Failed authentication attempt");
    return res.status(401).json({ error: "Invalid password" });
  } catch (err) {
    console.error("[admin-auth] Unhandled error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
