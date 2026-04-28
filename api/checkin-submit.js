const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'active client not found' });

    if (needsEscalation(issues)) {
      await escalateToMaddy('checkin_issue', maskPhone(client.phone), issues);
    }

    const { data: checkin, error } = await db.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }, {
      onConflict: 'client_id,week_no',
    }).select('id').single();

    if (error) {
      console.error('checkin upsert error:', error.message);
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
      } catch (_) {}
    }

    return res.json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
