const { getSupabase } = require('../lib/supabase');
const { shouldEscalate, createEscalation, checkMissedCheckins } = require('../lib/escalation');
const { cors, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (issues && shouldEscalate(issues)) {
    await createEscalation(client.phone, 'checkin_health_concern', issues);
  }

  const { error } = await db.from('checkins').upsert(
    {
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    },
    { onConflict: 'client_id,week_no' }
  );

  if (error) {
    console.error('Checkin save error:', error);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  await checkMissedCheckins(client_id, client.phone);

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, message: 'Check-in recorded' });
};
