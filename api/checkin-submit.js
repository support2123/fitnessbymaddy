const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, corsHeaders } = require('./_lib/utils');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

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
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (insertErr) {
      console.error('[Checkin] Insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await sendWhatsApp({
        phone: MADDY_PHONE,
        templateName: 'escalation_alert',
        bodyValues: [
          maskPhone(client.phone),
          'Health concern in check-in',
          issues.slice(0, 200),
        ],
      });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (e) {
        console.error('[Checkin] Program generation trigger failed:', e.message);
      }
    }

    await sendWhatsApp({
      phone: client.phone,
      templateName: 'checkin_confirmed',
      bodyValues: [client.name || 'there', String(week_no)],
    });

    return res.json({ ok: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('[Checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
