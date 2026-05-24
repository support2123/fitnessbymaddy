const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues) {
      const lowerIssues = issues.toLowerCase();
      const redFlags = ['pain', 'dizzy', 'dizziness', 'nausea', 'faint', 'injury', 'eating disorder'];
      const hasRedFlag = redFlags.some(flag => lowerIssues.includes(flag));

      if (hasRedFlag) {
        await sendTemplate(MADDY_PHONE, 'escalation_alert', [
          client.name || maskPhone(client.phone),
          'Health concern in check-in',
          issues.slice(0, 200)
        ]);
      }
    }

    const { count } = await db
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id);

    const missedConsecutive = week_no - (count || 0);
    if (missedConsecutive >= 2) {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        client.name || maskPhone(client.phone),
        '2+ consecutive missed check-ins',
        `Week ${week_no}, total submitted: ${count}`
      ]);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
