const { getSupabase } = require('./_lib/supabase');
const { cors, parseBody } = require('./_lib/utils');
const { needsEscalation, escalationReason, notifyMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id,
    week_no,
    weight,
    waist,
    compliance_score,
    energy,
    issues,
    photos_urls,
  } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'missing client_id or week_no' });
  }

  const db = getSupabase();

  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (clientErr || !client) {
    return res.status(404).json({ error: 'client not found' });
  }

  if (issues && needsEscalation(issues)) {
    await notifyMaddy({
      phone: client.phone,
      reason: escalationReason(issues),
      message: issues,
      type: 'Check-in health flag',
    });
  }

  const { data: checkin, error: insertErr } = await db
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

  if (insertErr) {
    return res.status(500).json({ error: 'failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin.id });
};
