const { getSupabase } = require('./lib/supabase');
const { checkEscalation } = require('./lib/escalation');
const { notifyMaddy } = require('./lib/whatsapp');

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
    photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (clientErr || !client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (client.status !== 'active') {
    return res.status(400).json({ error: 'Client program not active' });
  }

  const weekNum = parseInt(week_no, 10);
  if (isNaN(weekNum) || weekNum < 1 || weekNum > 24) {
    return res.status(400).json({ error: 'Invalid week number' });
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', weekNum)
    .single();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  const { data: checkin, error: insertErr } = await db.from('checkins').insert({
    client_id,
    week_no: weekNum,
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues?.slice(0, 2000) || null,
    photos_urls: photos_urls || []
  }).select().single();

  if (insertErr) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues) {
    const trigger = checkEscalation(issues);
    if (trigger) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: `Check-in week ${weekNum}: ${trigger}`,
        message_body: issues.slice(0, 500)
      });
      await notifyMaddy('Check-in Escalation', `Client ${client.phone.slice(-4)} week ${weekNum}: "${trigger}"`);
    }
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: weekNum + 1 })
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  res.status(200).json({ success: true, checkin_id: checkin?.id });
};
