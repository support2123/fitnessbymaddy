const { getSupabase } = require('../lib/supabase');
const { needsEscalation, json, maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return json(res, { error: 'Missing client_id or week_no' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return json(res, { error: 'Active client not found' }, 404);
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      return json(res, { error: 'Check-in already submitted for this week' }, 409);
    }

    const { data: checkin } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        client.phone,
        'Concerning check-in issues reported',
        issues,
        client_id
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
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (err) {
        console.error('Program generation trigger failed:', maskPhone(client.phone), err.message);
      }
    }

    return json(res, { success: true, checkin_id: checkin.id });

  } catch (err) {
    console.error('Check-in submit error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
