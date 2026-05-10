const { getSupabase } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/helpers');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
      photos_urls, next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      await db.from('checkins').update({
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        next_week_focus: next_week_focus || null,
        form_submitted_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await db.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        next_week_focus: next_week_focus || null,
        form_submitted_at: new Date().toISOString(),
      });
    }

    if (issues && needsEscalation(issues)) {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        ['checkin_concern', maskPhone(client.phone), issues.substring(0, 200)]
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
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    await sendWhatsApp(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no),
    ]);

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });

  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
