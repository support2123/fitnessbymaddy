const { getSupabase } = require('./lib/supabase');
const { notifyMaddy } = require('./lib/whatsapp');
const { needsEscalation, maskPhone, parseBody, corsHeaders, json } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  try {
    const body = await parseBody(req);
    const { client_id, week_no, weight, waist, compliance_score, energy, issues } = body;

    if (!client_id || !week_no) {
      return json(res, { error: 'client_id and week_no required' }, 400);
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('id, phone, name, program')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, { error: 'client not found' }, 404);

    let photosUrls = [];
    if (body.photos_urls) {
      photosUrls = Array.isArray(body.photos_urls) ? body.photos_urls : [body.photos_urls];
    }

    const { error } = await sb.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photosUrls,
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    if (error) {
      console.error('Checkin save error:', error.message);
      return json(res, { error: 'save failed' }, 500);
    }

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(
        'Client check-in flagged',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nIssues: ${issues}`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    return json(res, { ok: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
