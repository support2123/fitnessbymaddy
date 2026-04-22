const { supabase } = require('./_lib/supabase');
const { cors, json, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = body;

  if (!client_id || !week_no) {
    return json(res, 400, { error: 'client_id and week_no required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return json(res, 404, { error: 'Client not found' });
  if (client.status !== 'active') {
    return json(res, 400, { error: 'Client is not active' });
  }

  const { data: checkin, error } = await supabase
    .from('checkins')
    .upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }, { onConflict: 'client_id,week_no' })
    .select()
    .single();

  if (error) {
    console.error('Check-in save error:', error.message);
    return json(res, 500, { error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return json(res, 200, { success: true, checkin_id: checkin.id });
};
