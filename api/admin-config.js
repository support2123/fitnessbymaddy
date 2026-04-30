module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.json({
    supabase_url: process.env.SUPABASE_URL,
    supabase_anon_key: process.env.SUPABASE_ANON_KEY
  });
};
