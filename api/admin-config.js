module.exports = function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
};
