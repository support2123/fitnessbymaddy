const { getSupabase } = require('../lib/supabase');
const { checkEscalation, escalateToMaddy, checkMissedCheckins } = require('../lib/escalation');

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
      photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await sb
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const escalationTrigger = checkEscalation(issues);
    if (escalationTrigger) {
      await escalateToMaddy(client.phone, escalationTrigger, issues, client_id);
    }

    const { data: checkin, error } = await sb.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }).select().single();

    if (error) {
      console.error('Checkin save error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (['12wk', 'pcos', '40plus'].includes(client.program)) {
      const origin = req.headers.origin || req.headers.host || '';
      const protocol = origin.startsWith('http') ? '' : 'https://';
      const baseUrl = origin.startsWith('http') ? origin : `${protocol}${origin}`;

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(err => console.error('Program generation trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
