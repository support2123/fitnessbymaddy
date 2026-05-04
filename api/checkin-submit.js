const { supabase } = require('./lib/supabase');
const { parseBody, corsHeaders, json } = require('./lib/helpers');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = body;

    if (!client_id || !week_no) {
      return json(res, 400, { error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return json(res, 404, { error: 'Client not found' });

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Check-in flagged — health concern', {
        phone: client.phone,
        name: client.name,
        details: `Week ${week_no}: ${issues.slice(0, 300)}`
      });
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return json(res, 500, { error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id,
          week_no: parseInt(week_no) + 1
        })
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return json(res, 200, {
      ok: true,
      checkin_id: checkin.id,
      message: 'Check-in submitted successfully'
    });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
