module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  return res.status(200).json({
    supabase_url: process.env.SUPABASE_URL || '',
    supabase_anon_key: process.env.SUPABASE_ANON_KEY || ''
  });
};
