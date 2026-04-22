const { supabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    if (needsEscalation(issues)) {
      await escalateToMaddy('Concerning check-in response', {
        phone: maskPhone(client.phone),
        message: `Week ${week_no}: ${(issues || '').slice(0, 200)}`,
      });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight,
          waist,
          compliance_score,
          energy,
          issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no,
        weight,
        waist,
        compliance_score,
        energy,
        issues,
        photos_urls: photos_urls || [],
      });
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id, week_no });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
