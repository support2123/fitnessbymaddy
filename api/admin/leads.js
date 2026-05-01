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
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  return jsonResponse(res, 200, { leads: data || [] });
};
