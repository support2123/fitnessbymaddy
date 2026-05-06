const { getSupabase } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) {
    return res.status(404).json({ error: 'active client not found' });
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no, 10))
    .single();

  if (existing) {
    return res.status(409).json({ error: 'check-in already submitted for this week' });
  }

  const painKeywords = ['pain', 'dizzy', 'dizziness', 'hurt', 'injury', 'nausea'];
  if (issues && painKeywords.some(kw => issues.toLowerCase().includes(kw))) {
    await notifyMaddy(
      'Health concern in check-in',
      `Client: ${maskPhone(client.phone)} (Week ${week_no})\nIssue: ${issues.slice(0, 200)}`
    );
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues,
    photos_urls: photos_urls || []
  }).select().single();

  if (error) {
    console.error('[Checkin] Insert error:', error.message);
    return res.status(500).json({ error: 'failed to save' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
      });
    } catch (err) {
      console.error('[Checkin] Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, checkin_id: checkin.id });
};
