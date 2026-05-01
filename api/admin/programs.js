const { getSupabase } = require('../lib/supabase');
const { jsonResponse, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data: programs } = await supabase
    .from('programs')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(50);

  if (!programs || programs.length === 0) {
    return jsonResponse(res, 200, { programs: [] });
  }

  const clientIds = [...new Set(programs.map(p => p.client_id))];
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .in('id', clientIds);

  const clientMap = {};
  (clients || []).forEach(c => { clientMap[c.id] = c.name; });

  const enriched = programs.map(p => ({
    ...p,
    client_name: clientMap[p.client_id] || 'Unknown',
  }));

  return jsonResponse(res, 200, { programs: enriched });
};
