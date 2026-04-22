const { getSupabase } = require('../lib/supabase');
const { needsEscalation, parseBody, cors, maskPhone } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  try {
    const body = await parseBody(req);
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    if (issues && needsEscalation(issues)) {
      await escalate('Check-in flagged issue', client.phone, issues.slice(0, 300));
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Checkin] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('[Checkin] Failed to trigger program generation:', e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      checkin_id: checkin.id,
      message: 'Check-in submitted successfully!'
    });
  } catch (err) {
    console.error('[Checkin Submit] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
