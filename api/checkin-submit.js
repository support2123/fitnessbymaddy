const { getSupabase } = require('../lib/supabase');
const { shouldEscalate, createEscalation, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus,
    } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const escalationKeyword = shouldEscalate(issues);
    if (escalationKeyword) {
      await createEscalation('client', client.id, client.phone, `Check-in: ${escalationKeyword}`, issues);
    }

    const { data: checkin, error } = await sb
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        next_week_focus: next_week_focus || null,
      })
      .select()
      .single();

    if (error) throw error;

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
