const { supabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    // Verify client exists and is active
    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, program, name')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found or inactive' });
    }

    // Check for escalation in issues text
    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Check-in concern', {
        phone: client.phone,
        details: `Week ${week_no}: ${issues.slice(0, 150)}`
      });
    }

    // Insert check-in
    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (error) {
      console.error('Checkin save error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      // Call program generator asynchronously
      fetch(`${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
