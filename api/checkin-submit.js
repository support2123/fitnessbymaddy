const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { sendTemplate } = require('./_lib/whatsapp');

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

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!client) return res.status(404).json({ error: 'Active client not found' });

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no, 10),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
    energy: energy ? parseInt(energy, 10) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to save check-in' });

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy('Client check-in flag', client.phone, issues.slice(0, 300));
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (_) {
      // program generation runs async; failures are logged internally
    }
  }

  await sendTemplate(client.phone, 'checkin_received', [
    client.name || 'there',
    String(week_no),
  ]);

  return res.json({ ok: true, checkin_id: checkin.id });
};
