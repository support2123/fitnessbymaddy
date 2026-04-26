const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendToMaddy } = require('../lib/whatsapp');
const { needsEscalation, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }).select().single();

    if (issues && needsEscalation(issues)) {
      await sendToMaddy(
        `Client ${client.name || maskPhone(client.phone)} Week ${week_no} check-in flagged: "${issues.slice(0, 200)}"`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (err) {
        console.error('[Checkin] Failed to trigger program generation:', err.message);
      }
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no)
    ]);

    return res.status(200).json({ ok: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('[Checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
