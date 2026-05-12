const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge leads that went silent after 2 hours (not yet dropped)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await db
      .from('leads')
      .select('id, phone, name, last_msg_at, market')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (silentLeads) {
      for (const lead of silentLeads) {
        const rateLimited = await checkRateLimit(lead.phone);
        if (rateLimited) continue;

        const market = lead.market || detectMarket(lead.phone);
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ], market);
        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads from exactly 7 days ago (one-time re-engagement)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoStart = new Date(sevenDaysAgo.setHours(0, 0, 0, 0)).toISOString();
    const sevenDaysAgoEnd = new Date(sevenDaysAgo.setHours(23, 59, 59, 999)).toISOString();

    const { data: reengageLeads } = await db
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgoStart)
      .lte('last_msg_at', sevenDaysAgoEnd);

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: msgCount } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgoStart);

        if (msgCount && msgCount.length > 0) continue;

        const market = lead.market || detectMarket(lead.phone);
        await sendTemplate(lead.phone, 'reengage_7day', [
          lead.name || 'there'
        ], market);

        await db.from('leads').update({ status: 'new', last_msg_at: new Date().toISOString() })
          .eq('id', lead.id);
        reengaged++;
      }
    }

    // Nudge clients who haven't submitted check-ins (24hr and 48hr nudges)
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const isSunday = now.getDay() === 0;
    const isMonday = now.getDay() === 1;
    const isTuesday = now.getDay() === 2;

    let clientNudged = 0;
    if (isMonday || isTuesday) {
      const { data: activeClients } = await db
        .from('clients')
        .select('id, phone, name, program_started_at')
        .eq('status', 'active');

      if (activeClients) {
        for (const client of activeClients) {
          const startDate = new Date(client.program_started_at);
          const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
          const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .limit(1);

          if (!checkin || checkin.length === 0) {
            const nudgeType = isMonday ? 'checkin_nudge_24hr' : 'checkin_nudge_48hr';
            const market = detectMarket(client.phone);
            await sendTemplate(client.phone, nudgeType, [
              client.name || 'there',
              `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
            ], market);
            clientNudged++;
          }
        }
      }
    }

    return res.json({
      ok: true,
      nudged,
      dropped,
      reengaged,
      clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
