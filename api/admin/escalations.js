const { supabase } = require('../lib/supabase');

function verifyAdmin(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  return user === 'admin' && pass === process.env.ADMIN_PASSWORD;
}

module.exports = async function handler(req, res) {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: escalations } = await supabase
      .from('escalations')
      .select('*')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.status(200).json(escalations || []);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
};
