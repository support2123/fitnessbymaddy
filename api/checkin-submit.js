const { getSupabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/whatsapp');
const { escalate } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || week_no === undefined) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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

    if (needsEscalation(issues)) {
      await escalate(client.phone, 'checkin_issue', issues);
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await db.from('checkins').update({
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await db.from('checkins').insert({
        client_id,
        week_no,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || []
      });
    }

    const missedCount = await db
      .from('checkins')
      .select('id', { count: 'exact' })
      .eq('client_id', client_id)
      .is('form_submitted_at', null);

    if (missedCount.count >= 2) {
      await escalate(client.phone, '2_consecutive_missed_checkins', `Client has ${missedCount.count} missed check-ins`);
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: week_no + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
