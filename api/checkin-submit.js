const { supabase } = require('./lib/supabase');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .limit(1);

    if (!client || client.length === 0) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    });

    if (error) throw error;

    if (issues && needsEscalation(issues)) {
      await escalate(client[0].phone, `Check-in issue flagged (week ${week_no}): ${issues.slice(0, 80)}`);
    }

    if (client[0].program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: 'Check-in recorded' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
