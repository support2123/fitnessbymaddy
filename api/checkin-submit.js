const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');

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

  const { data: client, error: clientErr } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (clientErr || !client) return res.status(404).json({ error: 'Client not found' });

  if (issues && needsEscalation(issues)) {
    await notifyMaddy('Client reported concerning issue in check-in', {
      phone: client.phone,
      message: issues,
    });
  }

  const { error: insertErr } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    form_submitted_at: new Date().toISOString(),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  });

  if (insertErr) return res.status(500).json({ error: 'Failed to save check-in' });

  if (client.program === '12wk') {
    const origin = req.headers['x-forwarded-proto']
      ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host'] || req.headers.host}`
      : `https://${req.headers.host}`;

    await fetch(`${origin}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
    });
  }

  await sendTemplate(client.phone, 'checkin_received', [
    client.name || 'there',
    String(week_no),
  ]);

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
