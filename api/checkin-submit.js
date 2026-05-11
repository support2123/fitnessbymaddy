const { getSupabase } = require('./lib/supabase');
const { sendMessage, maskPhone } = require('./lib/whatsapp');
const { logMessage } = require('./lib/ratelimit');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body;

  if (!client_id || !week_no) {
    return res.status(400).json({ error: 'client_id and week_no required' });
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    form_submitted_at: new Date().toISOString(),
    weight: parseFloat(weight) || null,
    waist: parseFloat(waist) || null,
    compliance_score: parseInt(compliance_score) || null,
    energy: parseInt(energy) || null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  if (issues && issues.toLowerCase().match(/pain|dizz|sick|vomit|faint/)) {
    await sendMessage(MADDY_PHONE,
      `⚠️ Client ${maskPhone(client.phone)} reported issues in Week ${week_no} check-in: "${issues.slice(0, 150)}"`
    );
  }

  const program = client.program;
  if (program === '12wk' || program === '6wk_gym' || program === '6wk_home') {
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
      console.error('Program generation trigger failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, checkin_id: checkin.id });
};
