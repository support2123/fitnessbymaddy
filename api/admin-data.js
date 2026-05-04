const { supabase } = require('../lib/supabase');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { password, table, query } = req.body;

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const allowedTables = ['leads', 'clients', 'checkins', 'programs', 'messages'];
    if (!allowedTables.includes(table)) {
      return res.status(400).json({ error: 'Invalid table' });
    }

    let q = supabase.from(table).select('*');

    if (query) {
      if (query.filter) {
        Object.entries(query.filter).forEach(([key, val]) => {
          q = q.eq(key, val);
        });
      }
      if (query.order) {
        const [col, dir] = query.order.split('.');
        q = q.order(col, { ascending: dir === 'asc' });
      }
      if (query.limit) {
        q = q.limit(query.limit);
      }
    }

    const { data, error } = await q;
    if (error) throw error;

    return res.status(200).json({ data });
  } catch (err) {
    console.error('Admin data error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
