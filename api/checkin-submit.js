const { getSupabase } = require('../lib/supabase');
const { cors, needsEscalation, maskPhone } = require('../lib/helpers');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString()
  }).select().single();

  if (error) {
    console.error('Checkin insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (needsEscalation(issues)) {
    await notifyMaddy(
      'Client check-in has health flags',
      `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nIssues: ${issues}`
    );
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.json({ ok: true, checkin_id: checkin.id });
};
