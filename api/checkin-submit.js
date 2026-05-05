const { getSupabase } = require('./lib/supabase');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client || client.status !== 'active') {
    return res.status(404).json({ error: 'Client not found or inactive' });
  }

  const { error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: parseFloat(weight) || null,
    waist: parseFloat(waist) || null,
    compliance_score: parseInt(compliance_score) || null,
    energy: parseInt(energy) || null,
    issues: issues || null,
    photos_urls: photos_urls || []
  });

  if (error) {
    console.error('[CHECKIN] DB error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && /pain|dizz|can't move|swollen|numb/i.test(issues)) {
    await escalateToMaddy('Health concern in check-in', {
      phone: client.phone,
      message: issues
    });
  }

  const { data: missedCheckins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', client_id)
    .order('week_no', { ascending: false })
    .limit(3);

  if (client.program === '12wk') {
    const generateRes = await fetch(
      `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/generate-program`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }
    );
    if (!generateRes.ok) {
      console.error('[CHECKIN] Program generation trigger failed');
    }
  }

  return res.status(200).json({ success: true });
};
