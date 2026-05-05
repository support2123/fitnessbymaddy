const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  try {
    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }).select().single();

    if (insertErr) throw insertErr;

    if (needsEscalation(issues)) {
      await escalateToMaddy('Health concern in check-in', client.phone, issues);
    }

    if (client.program === '12wk') {
      await triggerProgramGeneration(client_id, parseInt(week_no) + 1);
    }

    return res.json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }
};

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo }),
    });
  } catch (err) {
    console.error('Program generation trigger failed:', err.message);
  }
}
