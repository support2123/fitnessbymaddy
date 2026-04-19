const { getSupabase } = require('../lib/supabase');
const { escalateToMaddy } = require('../lib/escalate');
const { needsEscalation, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
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

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
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
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }).select().single();

    if (error) {
      console.error('[CHECKIN ERROR]', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        'Health concern in check-in',
        client.phone,
        `Week ${week_no}: "${issues.slice(0, 200)}"`
      );
    }

    if (energy && parseInt(energy) <= 2) {
      await escalateToMaddy(
        'Very low energy reported',
        client.phone,
        `Week ${week_no}, energy: ${energy}/10`
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('[PROGRAM TRIGGER ERROR]', e.message);
      }
    }

    console.log(`[CHECKIN] ${maskPhone(client.phone)} week ${week_no}`);
    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[CHECKIN ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
