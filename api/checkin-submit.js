const { getSupabase } = require('../lib/supabase');
const { parseBody, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = body;

  if (!client_id || !week_no) {
    return json(res, 400, { error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) return json(res, 404, { error: 'Active client not found' });

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .single();

  if (existing) {
    return json(res, 409, { error: 'Check-in already submitted for this week' });
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  }).select().single();

  if (error) {
    console.error('Check-in insert error:', error.message);
    return json(res, 500, { error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return json(res, 200, { success: true, checkin_id: checkin.id });
};
