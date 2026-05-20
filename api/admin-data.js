const { supabase } = require('../lib/supabase');

const VALID_TABLES = ['leads', 'clients', 'checkins', 'programs', 'messages'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.replace('Bearer ', '') : '';

  if (!token || token !== (process.env.ADMIN_PASSWORD || process.env.SUPABASE_SERVICE_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const table = req.query.table;
  if (!table || !VALID_TABLES.includes(table)) {
    return res.status(400).json({ error: 'Invalid table' });
  }

  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
