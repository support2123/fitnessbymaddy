module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var password = req.body?.password;
  var adminPassword = process.env.ADMIN_PASSWORD || 'maddy2024';

  if (password === adminPassword) {
    return res.status(200).json({
      success: true,
      supabase_url: process.env.SUPABASE_URL,
      supabase_key: process.env.SUPABASE_SERVICE_KEY
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid password' });
};
