const { getSupabase } = require('../lib/supabase');
const { jsonResponse, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('direction', 'out')
    .eq('template_name', 'escalation_alert')
    .order('sent_at', { ascending: false })
    .limit(30);

  return jsonResponse(res, 200, { escalations: data || [] });
};
