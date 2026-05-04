const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy, checkMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (issues) {
      const escalation = needsEscalation(issues);
      if (escalation) {
        await escalateToMaddy(client.phone, `checkin_${escalation}`, issues);
      }
    }

    let photosUrls = [];
    if (req.body.photos_urls && Array.isArray(req.body.photos_urls)) {
      photosUrls = req.body.photos_urls;
    }

    const { data, error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues,
      photos_urls: photosUrls,
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    if (client.program === '12wk') {
      const origin = req.headers['x-forwarded-proto'] === 'https'
        ? `https://${req.headers['x-forwarded-host'] || req.headers.host}`
        : `http://${req.headers.host}`;

      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
