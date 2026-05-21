const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist, compliance_score,
      energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();
    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db.from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in weekly check-in',
        `Client: ${maskPhone(client.phone)}\nWeek ${week_no}\nIssues: ${(issues || '').slice(0, 300)}`
      );
    }

    if (client.program === '12wk') {
      const origin = req.headers['x-forwarded-proto']
        ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host'] || req.headers['host']}`
        : `https://${req.headers['host']}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, message: 'Check-in recorded' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
