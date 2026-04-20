const { supabase } = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: checkins, error } = await supabase
      .from('checkins')
      .select('*, clients(name)')
      .order('form_submitted_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    const formatted = (checkins || []).map(ch => ({
      ...ch,
      client_name: ch.clients?.name || 'Unknown'
    }));

    return res.status(200).json({ checkins: formatted });
  } catch (err) {
    console.error('Admin checkins error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
