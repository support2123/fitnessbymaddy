const { getSupabase } = require('./lib/supabase');
const { escalate } = require('./lib/escalate');
const { needsEscalation, cors, parseBody, maskPhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (needsEscalation(issues)) {
    await escalate(client.phone, 'checkin_concern', issues);
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .single();

  const checkinData = {
    client_id,
    week_no: parseInt(week_no, 10),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photos_urls || []
  };

  let result;
  if (existing) {
    result = await db.from('checkins').update(checkinData).eq('id', existing.id);
  } else {
    result = await db.from('checkins').insert(checkinData);
  }

  if (result.error) return res.status(500).json({ error: result.error.message });

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
      });
    } catch (err) {
      console.error(`Program gen trigger failed for ${maskPhone(client.phone)}: ${err.message}`);
    }
  }

  return res.json({ success: true, client_id, week_no });
};
