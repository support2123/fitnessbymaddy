const { getSupabase } = require('../lib/supabase');
const { needsEscalation, cors, parseBody } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no);

  if (!clientId || !weekNo) {
    return res.status(400).json({ error: 'Missing client_id or week_no' });
  }

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

  const photosUrls = [];
  if (body.photo_front) photosUrls.push(body.photo_front);
  if (body.photo_side) photosUrls.push(body.photo_side);
  if (body.photo_back) photosUrls.push(body.photo_back);

  const checkinData = {
    client_id: clientId,
    week_no: weekNo,
    form_submitted_at: new Date().toISOString(),
    weight: parseFloat(body.weight) || null,
    waist: parseFloat(body.waist) || null,
    compliance_score: Math.min(10, Math.max(1, parseInt(body.compliance) || 5)),
    energy: Math.min(10, Math.max(1, parseInt(body.energy) || 5)),
    issues: body.issues || null,
    photos_urls: photosUrls,
    next_week_focus: null,
  };

  const issuesText = `${body.issues || ''} ${body.notes || ''}`;
  if (needsEscalation(issuesText)) {
    await escalateToMaddy('Client check-in concern', {
      client_id: clientId,
      week: weekNo,
      issues: issuesText,
      phone: client.phone,
    }, { supabase });
  }

  const { error } = await supabase.from('checkins').insert(checkinData);

  if (error) {
    return res.status(500).json({ error: 'Failed to save check-in' });
  }

  if (client.program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 }),
      });
    } catch {}
  }

  return res.status(200).json({ ok: true, message: 'Check-in submitted' });
};
