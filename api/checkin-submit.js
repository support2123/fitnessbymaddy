const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { cors, parseBody, maskPhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });

  const { error } = await db.from('checkins').upsert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
    form_submitted_at: new Date().toISOString(),
  }, { onConflict: 'client_id,week_no' });

  if (error) {
    console.error('[CHECKIN] Insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (issues && /pain|dizz|eating disorder|vomit|faint/i.test(issues)) {
    await sendWhatsApp({
      phone: process.env.MADDY_PHONE || '+917082478374',
      templateName: 'escalation_alert',
      params: [client.name || maskPhone(client.phone), 'HEALTH_CONCERN', issues.slice(0, 100)],
    });
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (e) {
      console.error('[CHECKIN] Program generation trigger failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, message: 'Check-in submitted' });
};
