const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, maskPhone, jsonResponse, errorResponse } = require('./_lib/utils');
const { notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const body = req.body || {};
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = body;

  if (!client_id || !week_no) {
    return errorResponse(res, 'client_id and week_no required');
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!client) return errorResponse(res, 'Active client not found', 404);

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', parseInt(week_no))
    .maybeSingle();

  if (existing) return errorResponse(res, 'Check-in already submitted for this week');

  const { data: checkin } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  }).select().single();

  if (issues && needsEscalation(issues)) {
    await notifyMaddy(
      'Client check-in - health flag',
      `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssue: ${issues.slice(0, 500)}`
    );
  }

  const { count: missedCount } = await db
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client_id);

  const expectedWeeks = parseInt(week_no);
  const actualCheckins = (missedCount || 0);
  if (expectedWeeks - actualCheckins >= 2) {
    await notifyMaddy(
      '2+ missed check-ins',
      `Client: ${maskPhone(client.phone)}\nExpected ${expectedWeeks} check-ins, has ${actualCheckins}`
    );
  }

  if (client.program === '12wk') {
    try {
      await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return jsonResponse(res, { ok: true, checkin_id: checkin.id });
};
