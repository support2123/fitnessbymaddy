const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { currentWeekNo, isHinglish, maskPhone, jsonResponse } = require('../../lib/utils');
const { checkConsecutiveMissedCheckins } = require('../../lib/escalation');

const SITE_BASE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const { data: clients, error } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (error) {
      console.error(`[CRON CHECKIN] DB error: ${error.message}`);
      return jsonResponse(res, 500, { error: 'DB error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of (clients || [])) {
      const weekNo = currentWeekNo(client.program_started_at);
      const market = client.leads?.market || 'IN';

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        skipped++;
        continue;
      }

      const checkinUrl = `${SITE_BASE}/checkin?c=${client.id}&w=${weekNo}`;

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);
      }

      await checkConsecutiveMissedCheckins(client.id);

      sent++;
      console.log(`[CRON] Check-in sent: ${maskPhone(client.phone)} Week ${weekNo}`);
    }

    return jsonResponse(res, 200, {
      ok: true,
      sent,
      skipped,
      total: (clients || []).length
    });
  } catch (err) {
    console.error(`[CRON CHECKIN ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
