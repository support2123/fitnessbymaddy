const { getSupabase } = require('../lib/supabase');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body || {};

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db.from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

  if (issues && needsEscalation(issues)) {
    await notifyMaddy('Check-in escalation keyword', client.phone, issues);
  }

  const { data: checkin, error } = await db.from('checkins').upsert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString()
  }, { onConflict: 'client_id,week_no' }).select().single();

  if (error) {
    console.error('Checkin insert error:', error);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  await sendTemplate(client.phone, 'checkin_received', [
    client.name || 'there',
    String(week_no)
  ]);

  return res.status(200).json({ ok: true, checkin_id: checkin.id });
};
