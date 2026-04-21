const { getSupabase } = require('../_lib/supabase');
const { sendTextMessage } = require('../_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone, jsonResponse, errorResponse } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(res, 'GET or POST only', 405);
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    // Allow if running on Vercel (cron jobs are authenticated by Vercel)
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients?.length) {
      return jsonResponse(res, { message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) { results.skipped++; continue; }

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existing) { results.skipped++; continue; }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);

        const msg = isHinglish(market)
          ? `📋 *Week ${currentWeek} Check-in Time!*\n\n` +
            `${client.name || 'Hey'}, apna weekly update dene ka time aa gaya.\n\n` +
            `Weight, waist, photos aur progress — sab yahan bharo:\n` +
            `➡️ ${checkinUrl}\n\n` +
            `Isse tumhara naya plan accurate banega. 5 min lagega! ⏱`
          : `📋 *Week ${currentWeek} Check-in Time!*\n\n` +
            `${client.name || 'Hey'}, time for your weekly progress update.\n\n` +
            `Log your weight, waist, photos & progress here:\n` +
            `➡️ ${checkinUrl}\n\n` +
            `This helps us refine your next week's plan. Takes 5 min! ⏱`;

        await sendTextMessage(client.phone, msg);

        await db.from('nudge_log').insert({
          lead_id: client.lead_id || client.id,
          nudge_type: `checkin_w${currentWeek}`,
        });

        results.sent++;
      } catch (err) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
        results.errors++;
      }
    }

    scheduleNudges(db, activeClients);

    return jsonResponse(res, { message: 'Weekly check-in cron complete', results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

async function scheduleNudges(db, clients) {
  // Nudges are handled by checking who hasn't submitted after 24h and 48h
  // The nudge-dropped cron handles the re-check logic daily
}
