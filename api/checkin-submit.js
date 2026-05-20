const { supabase, maskPhone } = require('./_lib/supabase');
const { needsEscalation, escalate, checkMissedCheckins } = require('./_lib/escalation');

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

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (issues) {
      const escalationReason = needsEscalation(issues);
      if (escalationReason) {
        await escalate(client.phone, escalationReason, issues);
      }
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight, waist, compliance_score, energy, issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id, week_no, weight, waist,
        compliance_score, energy, issues,
        photos_urls: photos_urls || []
      });
    }

    await checkMissedCheckins(client_id, client.phone);

    if (client.program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
      try {
        await fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: week_no + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    console.log(`Check-in: ${maskPhone(client.phone)} week ${week_no}`);
    return res.json({ ok: true, message: 'Check-in received' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
