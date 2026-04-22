const { getSupabase } = require('./lib/supabase');
const { needsEscalation, maskPhone } = require('./lib/utils');
const { sendAndLog } = require('./lib/whatsapp');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = body;

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

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }).select().single();

    if (issues && needsEscalation(issues)) {
      await sendAndLog(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(client.phone), `Check-in W${week_no}: ${issues.slice(0, 200)}`],
        true
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = req.headers['x-forwarded-host']
          ? `https://${req.headers['x-forwarded-host']}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no, 10) + 1,
          }),
        });
      } catch (e) {
        console.error('Failed to trigger program generation:', e.message);
      }
    }

    await sendAndLog(client.phone, 'checkin_received', [
      client.name || 'there',
      `Week ${week_no}`,
    ], true);

    return res.status(200).json({ success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
