const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  try {
    // Verify client exists and is active
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Check for escalation triggers in issues
    if (issues) {
      const { needsEscalation, escalate } = require('./lib/escalation');
      if (needsEscalation(issues)) {
        await escalate(client.phone, 'Check-in health concern', issues.slice(0, 200));
      }
    }

    // Insert check-in
    const { data: checkin } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      await fetch(`${process.env.VERCEL_URL || 'https://www.fitnessbymaddy.com'}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
