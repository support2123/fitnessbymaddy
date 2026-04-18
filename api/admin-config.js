module.exports = function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anon_key: process.env.SUPABASE_ANON_KEY || ''
  });
};
