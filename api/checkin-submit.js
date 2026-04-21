const { getSupabase } = require('./_lib/supabase');
const { sendTextMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, needsEscalation, maskPhone, errorResponse, jsonResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photo_urls
    } = req.body;

    if (!client_id || !week_no) return errorResponse(res, 'Missing client_id or week_no');

    const { data: client } = await db
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) return errorResponse(res, 'Client not found', 404);

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) return errorResponse(res, 'Check-in already submitted for this week');

    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photo_urls || []
    }).select().single();

    if (error) throw error;

    if (issues && needsEscalation(issues)) {
      await db.from('escalations').insert({
        phone: client.phone,
        reason: 'checkin_concern',
        message_body: issues
      });
      await notifyMaddy('Check-in concern',
        `Client: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssue: ${issues}`
      );
    }

    const market = detectMarket(client.phone);
    if (isHinglish(market)) {
      await sendTextMessage(client.phone,
        `✅ Week ${week_no} check-in received!\n\n` +
        `Tumhara naya plan jaldi aayega. Keep pushing! 💪`
      );
    } else {
      await sendTextMessage(client.phone,
        `✅ Week ${week_no} check-in received!\n\n` +
        `Your updated plan is on its way. Keep going strong! 💪`
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
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (e) {
        console.error('Auto-generate next week failed:', e.message);
      }
    }

    return jsonResponse(res, { success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};
