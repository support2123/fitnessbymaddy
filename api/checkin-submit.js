const { supabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    let photosUrls = [];
    if (req.body.photos_urls && Array.isArray(req.body.photos_urls)) {
      photosUrls = req.body.photos_urls;
    }

    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues,
      photos_urls: photosUrls,
      next_week_focus,
    });

    if (error) {
      console.error('Checkin save error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Check-in issue flag', client.phone, issues);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
