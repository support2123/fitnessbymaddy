module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    supabase_url: process.env.SUPABASE_URL || '',
    supabase_anon_key: process.env.SUPABASE_ANON_KEY || '',
  });
};
