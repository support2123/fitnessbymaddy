const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, maskPhone, jsonResponse } = require('./_lib/utils');
const { notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, 404, { error: 'Client not found' });

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }).select().single();

    if (issues && needsEscalation(issues)) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'checkin_concern',
        message_body: issues
      });
      await notifyMaddy(
        'Check-in concern',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${week_no}\nIssue: ${issues}`
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
      } catch (e) {
        console.error('[Checkin] Program generation trigger failed:', e.message);
      }
    }

    return jsonResponse(res, 200, { ok: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('[Checkin Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
