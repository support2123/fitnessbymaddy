const { getSupabase } = require('../_lib/supabase');
const { sendWithRateLimit } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone, jsonResponse } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0 };

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return jsonResponse(res, 200, { ok: true, message: 'No active clients', ...results });
    }

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) {
        results.skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .single();

      if (existing) {
        results.skipped++;
        continue;
      }

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = missedCheckins ? missedCheckins.map(c => c.week_no) : [];
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: '2_consecutive_missed_checkins',
          message_body: `${client.name} missed ${consecutiveMissed} consecutive check-ins (current week: ${weekNo})`
        });
        await notifyMaddy(
          '2+ missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nMissed: ${consecutiveMissed} weeks`
        );
        results.escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      await sendWithRateLimit(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      results.sent++;
      console.log(`[Cron] Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
    }

    return jsonResponse(res, 200, { ok: true, ...results });
  } catch (err) {
    console.error('[Weekly Checkin Cron Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
