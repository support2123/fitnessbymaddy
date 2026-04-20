const { getSupabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: leads } = await db
      .from('leads')
      .select('phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json(leads || []);
  } catch (err) {
    console.error('Admin leads error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
