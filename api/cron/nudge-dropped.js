const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  try {
    const db = getSupabase();
    const now = new Date();
    let nudged = 0;
    let dropped = 0;

    // 1. Nudge leads that haven't replied in 2 hours (status=new, last_msg older than 2hr)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Find new leads needing 2hr nudge
    const { data: nudgeLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    for (const lead of (nudgeLeads || [])) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) continue;

      const market = lead.market || detectMarket(lead.phone);
      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: isHinglish(market)
          ? [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
          : [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
      });
      nudged++;
    }

    // 2. Drop leads that haven't replied in 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (staleLeads && staleLeads.length > 0) {
      const ids = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // 3. Re-engage dropped leads after 7 days (once only)
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      // Check if we already sent a re-engage message
      const { data: prevMessages } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (prevMessages && prevMessages.length > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      await sendTemplate(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: isHinglish(market)
          ? [lead.name || 'there']
          : [lead.name || 'there']
      });
      reEngaged++;
    }

    // 4. Nudge clients who haven't submitted check-in (+24hr, +48hr)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sunday = new Date(now);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    sunday.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: thisWeekCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (thisWeekCheckin && thisWeekCheckin.length > 0) continue;

      // Only nudge if it's been 24-48hrs since Sunday
      const hoursSinceSunday = (now - sunday) / (60 * 60 * 1000);
      if (hoursSinceSunday >= 24 && hoursSinceSunday < 72) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', {
          name: client.name || 'there',
          templateParams: [client.name || 'there', checkinUrl]
        });
        checkinNudges++;
      }
    }

    return res.status(200).json({
      nudged,
      dropped,
      reEngaged,
      checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
