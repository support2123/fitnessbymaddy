const { getClient } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy, buildEscalationDetails } = require('./_lib/notify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getClient();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Verify client exists and is active
    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'client not found or inactive' });
    }

    // Check for escalation in issues
    if (issues && needsEscalation(issues)) {
      const details = buildEscalationDetails(
        client.phone,
        issues,
        'weekly check-in health flag'
      );
      await notifyMaddy('Client Health Escalation', details);
    }

    // Upsert check-in
    const { data, error } = await sb.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no, 10),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }, {
      onConflict: 'client_id,week_no',
    }).select().single();

    if (error) throw error;

    // For 12-week clients, trigger program generation
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
        });
      } catch (_) {
        // program generation is async — failure doesn't block check-in
      }
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
