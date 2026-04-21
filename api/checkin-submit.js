const { supabase } = require('../lib/supabase');
const { sendJson, parseBody } = require('../lib/utils');
const { escalate, checkMissedCheckins } = require('../lib/escalation');
const { classifyIntent } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
      next_week_focus,
    } = body;

    if (!client_id || !week_no) {
      return sendJson(res, 400, { error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return sendJson(res, 404, { error: 'Active client not found' });
    }

    if (issues) {
      const intent = classifyIntent(issues);
      if (intent === 'ESCALATE') {
        await escalate(client.phone, 'Health concern in check-in', issues);
      }
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        next_week_focus: next_week_focus || null,
      }, {
        onConflict: 'client_id,week_no',
      })
      .select()
      .single();

    if (error) throw error;

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1,
          }),
        });
      } catch (genErr) {
        console.error('[CHECKIN] Program generation trigger failed:', genErr.message);
      }
    }

    return sendJson(res, 200, { success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[CHECKIN] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};
