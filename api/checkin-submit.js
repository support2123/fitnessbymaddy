const { getSupabase } = require('../lib/supabase');
const { parseBody, json, cors, needsEscalation, maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const {
    client_id, week_no, token,
    weight, waist, compliance_score, energy,
    issues, photos_urls
  } = body;

  if (!client_id || !week_no) {
    return json(res, 400, { error: 'client_id and week_no required' });
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) {
    return json(res, 404, { error: 'active client not found' });
  }

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .single();

  if (existing) {
    return json(res, 409, { error: 'check-in already submitted for this week' });
  }

  let photoUrls = photos_urls || [];
  if (req.headers['content-type']?.includes('multipart')) {
    // photo upload handled via Supabase Storage direct upload from frontend
    // photos_urls should be passed as pre-signed URLs from the form
  }

  const { data: checkin } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photoUrls,
    form_submitted_at: new Date().toISOString(),
  }).select().single();

  if (needsEscalation(issues)) {
    await escalateToMaddy(
      'Concerning check-in report',
      `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}`
    );
  }

  if (client.program === '12wk') {
    try {
      await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({
          client_id: client.id,
          week_no: parseInt(week_no) + 1,
        }),
      });
    } catch (_) {
      // async generation
    }
  }

  return json(res, 200, { ok: true, checkin_id: checkin.id });
};
