const { getSupabase } = require('./lib/supabase');
const { needsEscalation, notifyMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no,
      weight, waist,
      compliance_score, energy,
      issues, photos_urls,
      next_week_focus,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight: weight || null,
          waist: waist || null,
          compliance_score: compliance_score || null,
          energy: energy || null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          next_week_focus: next_week_focus || null,
          form_submitted_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        next_week_focus: next_week_focus || null,
        form_submitted_at: new Date().toISOString(),
      });
    }

    if (needsEscalation(issues)) {
      await notifyMaddy(
        'Check-in issue flagged',
        `${client.name || maskPhone(client.phone)} Week ${week_no}: ${(issues || '').slice(0, 200)}`
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (genErr) {
        console.error('Auto-generate trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Check-in error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
