const { supabase } = require('./_lib/supabase');
const { shouldEscalate, createEscalation, checkMissedCheckins } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || week_no === undefined) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    if (shouldEscalate(issues)) {
      await createEscalation({
        sourceType: 'client',
        sourceId: client_id,
        phone: client.phone,
        reason: 'Flagged content in weekly check-in',
        messageBody: issues
      });
    }

    const { error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    if (error) {
      console.error('Check-in insert error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    return res.json({ ok: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
