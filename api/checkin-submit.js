const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const weekNum = parseInt(week_no);

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNum)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error: insertErr } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: weekNum,
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Checkin insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.SUPABASE_SERVICE_KEY
          },
          body: JSON.stringify({ client_id, week_no: weekNum + 1 })
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};
