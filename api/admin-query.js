const { supabase } = require('../lib/supabase');

const ALLOWED_TABLES = ['leads', 'clients', 'checkins', 'programs', 'messages'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const key = authHeader ? authHeader.replace('Bearer ', '') : '';
  if (!key || key !== (process.env.ADMIN_KEY || process.env.SUPABASE_SERVICE_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { table, query } = req.body;
    if (!table || !ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ error: 'Invalid table' });
    }

    let q = supabase.from(table).select(query.select || '*');

    if (query.filter) {
      for (const [col, val] of Object.entries(query.filter)) {
        q = q.eq(col, val);
      }
    }

    if (query.order) {
      const [col, dir] = query.order.split('.');
      q = q.order(col, { ascending: dir === 'asc' });
    }

    if (query.limit) {
      q = q.limit(query.limit);
    }

    const { data, error } = await q;
    if (error) {
      console.error('Admin query error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ data });
  } catch (err) {
    console.error('Admin query error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
