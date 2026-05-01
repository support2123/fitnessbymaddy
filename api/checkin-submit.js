const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

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
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const db = getClient();

    const { data: client } = await db
      .from('clients')
      .select('phone, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client_not_found' });

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Health concern in weekly check-in', {
        phone: maskPhone(client.phone),
        detail: issues.slice(0, 300),
      });
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('checkin-submit insert error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (e) {
        console.error('program generation trigger failed:', e.message);
      }
    }

    return res.json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
