const { getSupabase } = require('../lib/supabase');
const { needsEscalation, jsonResponse, maskPhone } = require('../lib/utils');
const { escalateToMaddy, checkConsecutiveMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

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
      return jsonResponse(res, 400, { error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return jsonResponse(res, 404, { error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      await db.from('checkins').update({
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await db.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy(
        client.phone,
        'Check-in flagged: potential health concern',
        issues,
        client_id
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (genErr) {
        console.error(`[PROGRAM GEN TRIGGER] ${genErr.message}`);
      }
    }

    return jsonResponse(res, 200, {
      ok: true,
      message: 'Check-in submitted successfully'
    });
  } catch (err) {
    console.error(`[CHECKIN ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
