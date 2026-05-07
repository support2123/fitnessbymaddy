const { supabase } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  const { error } = await supabase.from('escalations').update({
    resolved: true,
    resolved_at: new Date().toISOString()
  }).eq('id', id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true });
};
