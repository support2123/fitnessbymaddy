const { getSupabase } = require('../lib/supabase');
const { json, cors, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

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
      photos_urls,
    } = req.body || {};

    if (!client_id || !week_no) {
      return json(res, { error: 'client_id and week_no required' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return json(res, { error: 'Active client not found' }, 404);
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1);

    if (existing && existing.length > 0) {
      return json(res, { error: 'Check-in already submitted for this week' }, 409);
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
      })
      .select()
      .single();

    if (error) throw error;

    const needsEscalation =
      issues && /pain|dizzy|dizziness|eating disorder|nausea|faint/i.test(issues);

    if (needsEscalation) {
      await db.from('escalations').insert({
        phone: client.phone,
        client_id: client.id,
        reason: `Health concern in check-in week ${week_no}: ${issues.slice(0, 200)}`,
        message_body: issues,
      });
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no) + 1,
          }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return json(res, { ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
