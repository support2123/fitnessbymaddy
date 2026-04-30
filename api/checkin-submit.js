const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
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
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!client) {
    return res.status(404).json({ error: 'Active client not found' });
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no, 10))
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  if (issues) {
    const keyword = needsEscalation(issues);
    if (keyword) {
      await createEscalation(client.phone, keyword, issues, client_id);
    }
  }

  const { data: checkin, error } = await db
    .from('checkins')
    .insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    })
    .select()
    .single();

  if (error) {
    console.error('checkin-submit error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify({
          client_id,
          week_no: parseInt(week_no, 10) + 1,
        }),
      });
    } catch (err) {
      console.error('Failed to trigger program generation:', err.message);
    }
  }

  return res.status(200).json({ ok: true, checkin_id: checkin.id });
};
