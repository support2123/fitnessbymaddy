const { supabase } = require('./lib/supabase');
const { notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { corsHeaders, json, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const clientId = body.client_id;
    const weekNo = parseInt(body.week_no);

    if (!clientId || !weekNo) {
      return json(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) return json(res, 404, { error: 'Client not found' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', weekNo)
      .single();

    if (existing) return json(res, 409, { error: 'Check-in already submitted for this week' });

    const photosUrls = [];
    if (body.photo_front) photosUrls.push(body.photo_front);
    if (body.photo_side) photosUrls.push(body.photo_side);
    if (body.photo_back) photosUrls.push(body.photo_back);

    const checkin = {
      client_id: clientId,
      week_no: weekNo,
      weight: body.weight ? parseFloat(body.weight) : null,
      waist: body.waist ? parseFloat(body.waist) : null,
      compliance_score: body.compliance ? parseInt(body.compliance) : null,
      energy: body.energy ? parseInt(body.energy) : null,
      issues: body.issues || null,
      photos_urls: photosUrls
    };

    const { error } = await supabase.from('checkins').insert(checkin);
    if (error) return json(res, 500, { error: 'Failed to save check-in' });

    const issuesText = (body.issues || '').toLowerCase();
    const dangerKeywords = ['pain', 'dizz', 'faint', 'nausea', 'vomit', 'eating disorder', 'not eating', 'starving'];
    const needsEscalation = dangerKeywords.some(kw => issuesText.includes(kw));

    if (needsEscalation) {
      await notifyMaddy(
        'Client health concern in check-in',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek ${weekNo}\nIssues: "${body.issues}"`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return json(res, 200, { success: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};
