const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage } = require('./_lib/whatsapp');
const { needsEscalation, maskPhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    let photosUrls = [];
    if (req.body.photos_urls) {
      photosUrls = Array.isArray(req.body.photos_urls)
        ? req.body.photos_urls
        : [req.body.photos_urls];
    }

    await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: parseInt(compliance_score) || null,
      energy: parseInt(energy) || null,
      issues: issues || null,
      photos_urls: photosUrls,
      next_week_focus: next_week_focus || null,
    });

    if (issues && needsEscalation(issues)) {
      await sendTemplate(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [maskPhone(client.phone), `Week ${week_no} check-in: ${issues.slice(0, 200)}`]
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no),
    ]);
    await logMessage(client.phone, 'out', `Check-in week ${week_no} received`, 'checkin_received');

    return res.json({ status: 'ok', message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
