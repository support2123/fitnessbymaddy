const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await db.from('checkins').update({
        weight, waist, compliance_score, energy, issues,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await db.from('checkins').insert({
        client_id, week_no, weight, waist,
        compliance_score, energy, issues,
        photos_urls: photos_urls || []
      });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy({
        reason: 'Concerning issue in weekly check-in',
        phone: client.phone,
        message: issues,
        clientName: client.name
      });
    }

    if (energy && energy <= 3) {
      await escalateToMaddy({
        reason: 'Very low energy reported (score: ' + energy + ')',
        phone: client.phone,
        message: `Energy: ${energy}/10, Issues: ${issues || 'none'}`,
        clientName: client.name
      });
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: week_no + 1 })
      }).catch(err => console.error('Program generation trigger failed:', err.message));
    }

    const market = detectMarket(client.phone);
    const isHinglish = market === 'IN';

    const thankYouMsg = isHinglish
      ? `Check-in Week ${week_no} mil gaya ✅ Great job staying consistent! Aapka next week ka plan jaldi aayega 💪`
      : `Week ${week_no} check-in received ✅ Great job staying consistent! Your next week's plan will be ready soon 💪`;

    await sendWhatsApp({ phone: client.phone, body: thankYouMsg });

    return res.json({ success: true, week_no });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
