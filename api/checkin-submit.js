const { getSupabase } = require('./_lib/supabase');
const { cors } = require('./_lib/helpers');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const b = req.body || {};

  const clientId = b.client_id;
  const weekNo = parseInt(b.week_no, 10);

  if (!clientId || !weekNo) {
    return res.status(400).json({ error: 'missing client_id or week_no' });
  }

  const { data: client } = await db
    .from('clients')
    .select('id, phone, program')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'client_not_found' });

  if (needsEscalation(b.issues)) {
    await escalateToMaddy('checkin_health_flag', client.phone, b.issues);
  }

  const photosUrls = [];
  if (b.photos_urls) {
    const urls = Array.isArray(b.photos_urls) ? b.photos_urls : [b.photos_urls];
    photosUrls.push(...urls.filter(Boolean));
  }

  const { error } = await db.from('checkins').upsert({
    client_id: clientId,
    week_no: weekNo,
    weight: b.weight ? parseFloat(b.weight) : null,
    waist: b.waist ? parseFloat(b.waist) : null,
    compliance_score: b.compliance ? parseInt(b.compliance, 10) : null,
    energy: b.energy ? parseInt(b.energy, 10) : null,
    issues: b.issues || null,
    photos_urls: photosUrls,
    form_submitted_at: new Date().toISOString()
  }, { onConflict: 'client_id,week_no' });

  if (error) {
    console.error('[Checkin] Upsert error:', error.message);
    return res.status(500).json({ error: 'save_failed' });
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
      });
    } catch (err) {
      console.error('[Checkin] Program gen trigger failed:', err.message);
    }
  }

  return res.json({ ok: true });
};
