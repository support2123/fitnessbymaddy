const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getClient();
  const {
    client_id,
    week_no,
    weight,
    waist,
    compliance_score,
    energy,
    issues,
    photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client || client.status !== 'active') {
    return res.status(404).json({ error: 'Active client not found' });
  }

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy('Check-in issue flag', client.phone, issues);
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  }).select().single();

  if (error) {
    console.error('Checkin insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, checkin_id: checkin?.id });
};
