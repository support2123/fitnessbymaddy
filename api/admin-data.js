const { getSupabase } = require('./_lib/supabase');

const ALLOWED_TABLES = ['leads', 'clients', 'checkins', 'programs', 'messages'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = getSupabase();
  const { data: user, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const table = req.query.table;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const filter = req.query.filter;

  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: 'Invalid table' });
  }

  let query = db.from(table).select('*').order('created_at' in {} ? 'created_at' : 'id', { ascending: false }).limit(limit);

  if (table === 'messages' && filter === 'escalation') {
    query = db.from('messages')
      .select('*')
      .eq('template_name', 'escalation_alert')
      .order('sent_at', { ascending: false })
      .limit(limit);
  }

  if (table === 'leads') {
    query = db.from('leads').select('*').order('created_at', { ascending: false }).limit(limit);
  }

  if (table === 'clients') {
    query = db.from('clients').select('*').order('program_started_at', { ascending: false }).limit(limit);
  }

  if (table === 'checkins') {
    query = db.from('checkins').select('*').order('form_submitted_at', { ascending: false }).limit(limit);
  }

  if (table === 'programs') {
    query = db.from('programs').select('*').order('generated_at', { ascending: false }).limit(limit);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error('Admin data error:', error);
    return res.status(500).json({ error: 'Query failed' });
  }

  return res.status(200).json({ rows: rows || [] });
};
