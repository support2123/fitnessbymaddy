const { getSupabase } = require('../lib/supabase');
const { needsEscalation, jsonResponse } = require('../lib/helpers');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, {}, 200);
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();
  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls,
  } = req.body || {};

  if (!client_id || !week_no) {
    return jsonResponse(res, { error: 'client_id and week_no required' }, 400);
  }

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .single();

  if (!client) return jsonResponse(res, { error: 'Client not found' }, 404);

  const { data: checkin, error } = await db.from('checkins').insert({
    client_id,
    week_no: parseInt(week_no),
    weight: weight ? parseFloat(weight) : null,
    waist: waist ? parseFloat(waist) : null,
    compliance_score: compliance_score ? parseInt(compliance_score) : null,
    energy: energy ? parseInt(energy) : null,
    issues: issues || null,
    photos_urls: photos_urls || [],
  }).select().single();

  if (error) {
    console.error('Checkin insert error:', error.message);
    return jsonResponse(res, { error: 'Failed to save check-in' }, 500);
  }

  if (issues && needsEscalation(issues)) {
    await notifyMaddy(
      'Client check-in flagged',
      `Client: ${client.name} (${client.phone})\nWeek ${week_no}\nIssue: "${issues.slice(0, 200)}"`
    );
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
      });
    } catch (err) {
      console.error('Program generation trigger failed:', err.message);
    }
  }

  return jsonResponse(res, { ok: true, checkin_id: checkin.id });
};
