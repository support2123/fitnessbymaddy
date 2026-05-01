const { getSupabase } = require('../lib/supabase');
const { jsonResponse, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data: checkins } = await supabase
    .from('checkins')
    .select('*')
    .order('form_submitted_at', { ascending: false })
    .limit(50);

  if (!checkins || checkins.length === 0) {
    return jsonResponse(res, 200, { checkins: [] });
  }

  const clientIds = [...new Set(checkins.map(c => c.client_id))];
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .in('id', clientIds);

  const clientMap = {};
  (clients || []).forEach(c => { clientMap[c.id] = c.name; });

  const enriched = checkins.map(c => ({
    ...c,
    client_name: clientMap[c.client_id] || 'Unknown',
  }));

  return jsonResponse(res, 200, { checkins: enriched });
};
