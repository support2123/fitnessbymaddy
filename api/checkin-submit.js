const { supabase } = require('../lib/supabase');
const { needsEscalation, cors } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

  if (!client_id || !week_no) return res.status(400).json({ error: 'Missing client_id or week_no' });

  const client = await supabase.from('clients').select('*').eq('id', client_id).single();
  if (!client.data) return res.status(404).json({ error: 'Client not found' });

  if (needsEscalation(issues)) {
    await escalate(client.data.phone, 'checkin_health_concern', issues, client_id);
  }

  const existing = await supabase
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .single();

  if (existing.data) {
    return res.status(409).json({ error: 'Check-in already submitted for this week' });
  }

  const { data, error } = await supabase.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  if (client.data.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (_) {}
  }

  return res.json({ success: true, checkin_id: data.id });
};
