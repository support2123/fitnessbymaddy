module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`window.__SUPABASE_URL__="${process.env.SUPABASE_URL || ''}";window.__SUPABASE_ANON_KEY__="${process.env.SUPABASE_ANON_KEY || ''}";`);
};
