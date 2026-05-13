const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const data = req.body;

  if (!data.client_id || !data.week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('*')
    .eq('id', data.client_id)
    .eq('status', 'active')
    .single();

  if (clientErr || !client) {
    return res.status(404).json({ error: 'Active client not found' });
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', data.client_id)
    .eq('week_no', parseInt(data.week_no))
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  if (data.issues && needsEscalation(data.issues)) {
    await escalateToMaddy({
      phone: client.phone,
      reason: 'Health concern in check-in',
      messageBody: data.issues,
      clientId: client.id
    });
  }

  const { error: insertErr } = await db.from('checkins').insert({
    client_id: data.client_id,
    week_no: parseInt(data.week_no),
    weight: data.weight ? parseFloat(data.weight) : null,
    waist: data.waist ? parseFloat(data.waist) : null,
    compliance_score: data.compliance_score ? parseInt(data.compliance_score) : null,
    energy: data.energy ? parseInt(data.energy) : null,
    issues: data.issues || null,
    photos_urls: data.photos_urls || [],
    next_week_focus: data.next_week_focus || null
  });

  if (insertErr) {
    console.error('Check-in insert error:', insertErr.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          client_id: client.id,
          week_no: parseInt(data.week_no) + 1
        })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
};
