const { getSupabase } = require('./lib/supabase');
const { corsHeaders } = require('./lib/utils');
const { escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db.from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }).select().single();

    if (error) {
      console.error('[checkin-submit] DB error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && /\b(pain|dizz|chakkar|hurt|injury|nahi ho raha|can't move)\b/i.test(issues)) {
      await escalateToMaddy('Health concern in check-in', client, issues);
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'www.fitnessbymaddy.com';
      fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(err => console.error('[checkin-submit] Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[checkin-submit] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
