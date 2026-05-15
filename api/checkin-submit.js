const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy, getEscalationReason } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    // Escalation check on issues text
    if (issues && needsEscalation(issues)) {
      await escalateToMaddy({
        phone: client.phone,
        clientId: client_id,
        reason: getEscalationReason(issues),
        messageBody: `Check-in week ${week_no}: ${issues}`,
      });
    }

    const { data: checkin, error } = await supabase
      .from('checkins').upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString(),
      }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, checkinId: checkin.id });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
