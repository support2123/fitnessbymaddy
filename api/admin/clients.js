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
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    return res.status(200).json(clients || []);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
};
