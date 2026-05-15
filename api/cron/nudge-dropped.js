const { supabase } = require('../_lib/supabase');
const { sendTemplate, canSendMessage } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // FLOW A nudges: leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads who haven't responded in 2 hours
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', oneDayAgo);

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads, count: dropped } = await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', oneDayAgo)
      .select('id', { count: 'exact' });

    // Nudge active clients with pending check-ins (+24h, +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getUTCDay();
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const allowed = await canSendMessage(client.phone, true);
        if (!allowed) continue;

        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(weekNo)
        ]);
        checkinNudges++;
      }

      // Escalate 2 consecutive missed check-ins
      if (weekNo >= 2) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .single();

        if (!prevCheckin && !checkin) {
          const { escalateToMaddy } = require('../_lib/escalation');
          await escalateToMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            name: client.name,
            message: `Weeks ${weekNo - 1} and ${weekNo} both missed`
          });
        }
      }
    }

    // Re-engage dropped leads (7-day rule — one-time re-engagement)
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    for (const lead of (reengageLeads || [])) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = lead.market || 'GLOBAL';
      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'reengage_7day_hi', [lead.name || 'there']);
      } else {
        await sendTemplate(lead.phone, 'reengage_7day_en', [lead.name || 'there']);
      }
      reengaged++;
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped: dropped || 0,
      checkin_nudges: checkinNudges,
      reengaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
