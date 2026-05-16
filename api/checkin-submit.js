const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { needsEscalation, escalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  if (issues && needsEscalation(issues)) {
    await escalate(client.phone, 'checkin_issue', issues);
  }

  const { error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: parseFloat(weight) || null,
    waist: parseFloat(waist) || null,
    compliance_score: parseInt(compliance_score) || null,
    energy: parseInt(energy) || null,
    issues: issues || null,
    photos_urls: photos_urls || []
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  await sendWhatsApp(client.phone, 'checkin_received', {
    name: client.name || 'there',
    templateParams: [String(week_no)]
  });

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
