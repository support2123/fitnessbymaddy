const { supabase } = require('../lib/supabase');
const { needsEscalation, escalate, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    if (issues && needsEscalation(issues)) {
      await escalate(client.phone, 'Check-in concern flagged', issues);
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await supabase.from('checkins')
        .update({
          weight, waist, compliance_score, energy, issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight, waist, compliance_score, energy, issues,
        photos_urls: photos_urls || []
      });
    }

    await checkMissedCheckins(supabase, client_id, client.phone);

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
      } catch (genErr) {
        console.error('Program gen trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
