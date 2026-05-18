const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'missing client_id or week_no' });
  }

  try {
    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'client not active' });

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'check-in already submitted for this week' });
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

    if (issues) {
      const escalationReason = needsEscalation(issues);
      if (escalationReason) {
        await createEscalation(client.phone, `Check-in flag: ${escalationReason}`, issues, client_id);
      }
    }

    if (client.program === '12wk') {
      const nextWeek = parseInt(week_no) + 1;
      const maxWeek = 12;

      if (nextWeek <= maxWeek) {
        try {
          await fetch('https://fitnessbymaddy.com/api/generate-program', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
            },
            body: JSON.stringify({ client_id, week_no: nextWeek }),
          });
        } catch (genErr) {
          console.error('Program generation trigger failed:', genErr.message);
        }
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
