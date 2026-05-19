const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getClient();
    const now = new Date();

    // Re-engage leads that went silent 2hrs ago (no reply to welcome)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .ilike('template_name', '%nudge%');

        if (count && count > 0) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    // Drop leads with no reply after 24hrs
    const { data: expiredLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'in');

        const inboundCount = count || 0;
        if (inboundCount <= 1) {
          await db.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Nudge clients who haven't submitted check-in (24hr and 48hr reminders)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;
        const dayOfWeek = now.getDay(); // 0=Sun

        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            `${weekNo}`,
            checkinUrl
          ]);
        } else {
          await sendTemplate(client.phone, 'checkin_reminder_en', [
            client.name || 'there',
            `${weekNo}`,
            checkinUrl
          ]);
        }
        clientNudges++;
      }
    }

    console.log(`[Cron] Nudge: nudged=${nudged}, dropped=${dropped}, clientNudges=${clientNudges}`);
    return res.status(200).json({ ok: true, nudged, dropped, clientNudges });
  } catch (err) {
    console.error('[Cron] Nudge error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
