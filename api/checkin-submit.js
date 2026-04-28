const { supabase } = require('../lib/supabase');
const { escalateToMaddy } = require('../lib/escalate');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (issues && (
      issues.toLowerCase().includes('pain') ||
      issues.toLowerCase().includes('dizz') ||
      issues.toLowerCase().includes('eating')
    )) {
      await escalateToMaddy(
        'Client reported concerning issue',
        `Client: ${maskPhone(client.phone)}\nWeek ${week_no}: ${issues.slice(0, 200)}`
      );
    }

    if (client.program === '12wk') {
      const origin = req.headers['x-forwarded-proto'] === 'https'
        ? `https://${req.headers['x-forwarded-host'] || req.headers['host']}`
        : `http://${req.headers['host']}`;

      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.json({ ok: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
