const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls, next_week_focus
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.status !== 'active') return res.status(400).json({ error: 'Client is not active' });

  if (needsEscalation(issues)) {
    await escalateToMaddy('Health concern in weekly check-in', {
      phone: client.phone,
      details: `Week ${week_no}: ${issues}`
    });
  }

  const { data: existing } = await supabase
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  const { error } = await supabase.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    next_week_focus: next_week_focus || null
  });

  if (error) {
    console.error('Check-in save error:', error);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id, week_no });
};
