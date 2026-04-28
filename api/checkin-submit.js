const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist, compliance_score,
    energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no are required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) {
    return res.status(404).json({ error: 'Active client not found' });
  }

  const { error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: weight || null,
    waist: waist || null,
    compliance_score: compliance_score || null,
    energy: energy || null,
    issues: issues || null,
    photos_urls: photos_urls || []
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && needsEscalation(issues)) {
    await escalateToMaddy(
      'Concerning check-in issues',
      `Client: ${client.name} | Week ${week_no} | Issues: ${issues}`
    );
  }

  if (client.program === '12wk') {
    try {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      });
    } catch (e) {
      // Program generation is async; failures are logged separately
    }
  }

  await sendWhatsApp(client.phone, 'checkin_received', [
    client.name || 'there',
    String(week_no)
  ]);

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
