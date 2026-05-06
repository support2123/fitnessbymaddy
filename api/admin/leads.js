const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data } = await supabase
      .from('leads')
      .select('id, phone, name, status, program_interest, market, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('[Admin/Leads]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
