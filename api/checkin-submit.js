const { getClient } = require('../lib/supabase');
const { needsEscalation } = require('../lib/helpers');
const { sendTemplate } = require('../lib/whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no, 10))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    let photosUrls = [];
    if (body.photos_urls) {
      photosUrls = Array.isArray(body.photos_urls)
        ? body.photos_urls
        : [body.photos_urls];
    }

    const { data: checkin } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: body.weight ? parseFloat(body.weight) : null,
        waist: body.waist ? parseFloat(body.waist) : null,
        compliance_score: body.compliance_score
          ? parseInt(body.compliance_score, 10)
          : null,
        energy: body.energy ? parseInt(body.energy, 10) : null,
        issues: body.issues || null,
        photos_urls: photosUrls,
      })
      .select()
      .single();

    if (body.issues && needsEscalation(body.issues)) {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        client.name || client.phone,
        `Week ${week_no} check-in issue: ${body.issues.substring(0, 200)}`,
      ]);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no, 10) + 1,
          }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
