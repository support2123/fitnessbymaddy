const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText, maskPhone, isHinglish, detectMarket } = require('../../lib/whatsapp');
const { canSendMessage, logMessage } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const now = new Date();

    // FLOW A step 3: Nudge leads with no reply in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;

    for (const lead of staleNewLeads || []) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      });
      await logMessage(lead.phone, 'out', 'Trial nudge sent', 'nudge_trial');
      nudged++;
    }

    // FLOW A step 4: Drop leads with no reply in 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads && deadLeads.length > 0) {
      const ids = deadLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads (7-day rule: re-engage once after 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    for (const lead of reengageLeads || []) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      await sendTemplate(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      });
      await logMessage(lead.phone, 'out', '7-day re-engagement', 'reengage_7day');
      reengaged++;
    }

    // Nudge active clients with pending check-ins (+24h, +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    for (const client of activeClients || []) {
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

      const { data: lastReminder } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', client.phone)
        .eq('template_name', 'weekly_checkin_reminder')
        .order('sent_at', { ascending: false })
        .limit(1)
        .single();

      if (!lastReminder) continue;

      const hoursSinceReminder = (now - new Date(lastReminder.sent_at)) / (1000 * 60 * 60);

      if ((hoursSinceReminder >= 24 && hoursSinceReminder < 26) ||
          (hoursSinceReminder >= 48 && hoursSinceReminder < 50)) {
        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const msg = `Reminder: Your Week ${weekNo} check-in is still pending! 📝\n\n${formUrl}\n\nDon't skip it — your next program depends on it!`;

        await sendText(client.phone, msg);
        await logMessage(client.phone, 'out', msg, 'checkin_nudge');
        clientNudges++;
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reengaged, clientNudges });
  } catch (err) {
    console.error('[Nudge Cron Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
