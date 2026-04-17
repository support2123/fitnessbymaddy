const { supabase } = require('../../lib/supabase');
const { canSendMessage, sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;
    let dropped = 0;

    // 1. Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    for (const lead of (staleNew || [])) {
      const lastMsg = lead.last_msg_at || lead.created_at;
      const hoursSinceMsg = (now - new Date(lastMsg)) / (1000 * 60 * 60);

      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', lead.created_at);

      // 2-hour nudge: send trial link if only 1 message sent (the welcome)
      if (hoursSinceMsg >= 2 && hoursSinceMsg < 24 && count <= 1) {
        if (await canSendMessage(lead.phone, false)) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
          ], lead.name);
          nudged++;
        }
      }

      // 24-hour drop: mark as dropped
      if (hoursSinceMsg >= 24) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // 2. Re-engage dropped leads (7-day rule: try once more after 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_v1');

      if (count === 0 && await canSendMessage(lead.phone, false)) {
        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);
        await sendTemplate(lead.phone, 'reengage_v1', [
          lead.name || 'there',
        ], lead.name);
        reEngaged++;
      }
    }

    // 3. Nudge active clients who haven't submitted check-ins
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const isSunday = now.getUTCDay() === 0;
    const isMonday = now.getUTCDay() === 1;
    const isTuesday = now.getUTCDay() === 2;

    if (isMonday || isTuesday) {
      const { data: activeClients } = await supabase
        .from('clients')
        .select('*')
        .eq('status', 'active');

      let clientNudged = 0;
      for (const client of (activeClients || [])) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (!checkin) {
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'https://fitnessbymaddy.com';
          const checkinUrl = `${baseUrl}/checkin?c=${client.id}&w=${weekNo}`;

          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ], client.name);
          clientNudged++;
        }
      }

      return res.status(200).json({
        message: 'Nudge cron complete',
        leads_nudged: nudged,
        leads_dropped: dropped,
        leads_reengaged: reEngaged,
        clients_nudged: clientNudged,
      });
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      leads_nudged: nudged,
      leads_dropped: dropped,
      leads_reengaged: reEngaged,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
