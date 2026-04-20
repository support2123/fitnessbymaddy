const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, maskPhone, jsonResponse } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (error) {
      console.error(`[CRON NUDGE] DB error: ${error.message}`);
      return jsonResponse(res, 500, { error: 'DB error' });
    }

    let sent = 0;

    for (const lead of (leads || [])) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('template_name', '%re_engage%');

      if (count && count > 0) continue;

      const market = lead.market || 'IN';

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 're_engage_v1', [
          lead.name || 'there'
        ]);
      } else {
        await sendTemplate(lead.phone, 're_engage_v1_en', [
          lead.name || 'there'
        ]);
      }

      sent++;
      console.log(`[NUDGE] Re-engage sent: ${maskPhone(lead.phone)}`);
    }

    const twentyFourHrsAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHrsAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let nudged = 0;
    for (const client of (pendingClients || [])) {
      const start = new Date(client.program_started_at);
      const now = new Date();
      const currentWeek = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      const { data: lastMsg } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (lastMsg) {
        const lastSent = new Date(lastMsg.sent_at);
        const hoursSince = (now - lastSent) / (1000 * 60 * 60);
        if (hoursSince < 20) continue;
      }

      await sendTemplate(client.phone, 'checkin_reminder', [
        client.name || 'there',
        String(currentWeek),
        `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`
      ]);

      nudged++;
    }

    return jsonResponse(res, 200, {
      ok: true,
      leads_re_engaged: sent,
      clients_nudged: nudged
    });
  } catch (err) {
    console.error(`[CRON NUDGE ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
