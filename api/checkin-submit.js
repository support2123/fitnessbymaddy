const { getSupabase } = require('../lib/supabase');
const { needsEscalation, detectEscalationReason, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id,
      week_no,
      token,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('id, phone, program, status')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existingCheckin) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    if (issues && needsEscalation(issues)) {
      const reason = detectEscalationReason(issues);
      await escalateToMaddy(client.phone, reason, issues);
    }

    const { data: checkin, error: checkinErr } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues ? issues.substring(0, 2000) : null,
        photos_urls: photos_urls || [],
      })
      .select()
      .single();

    if (checkinErr) {
      console.error('Checkin insert error:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger error:', genErr.message);
      }
    }

    return res.status(200).json({ saved: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
