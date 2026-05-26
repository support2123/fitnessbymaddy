const { getSupabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  let photoUrls = [];
  if (req.body.photos_urls) {
    photoUrls = Array.isArray(req.body.photos_urls)
      ? req.body.photos_urls
      : [req.body.photos_urls];
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photoUrls
  }).select().single();

  if (error) {
    console.error('Checkin insert error:', error);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && issues.length > 0) {
    const { needsEscalation } = require('../lib/escalation');
    if (needsEscalation(issues)) {
      await notifyMaddy(
        `Health concern in check-in from ${maskPhone(client.phone)}`,
        `Client: ${client.name}\nWeek ${week_no}\nIssues: "${issues.slice(0, 300)}"`
      );
    }
  }

  if (client.program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';

    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
    }).catch(err => console.error('Program generation trigger failed:', err.message));
  }

  return res.status(200).json({ ok: true, checkin_id: checkin.id });
};
