const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find leads that went silent (new status, last message > 2hrs ago, < 24hrs)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const hinglish = isHinglish(detectMarket(lead.phone));
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          bodyValues: hinglish
            ? [lead.name || 'there']
            : [lead.name || 'there'],
        });
        nudged++;
      }
    }

    // Mark leads with no reply after 24hrs as dropped
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule: dropped > 7 days ago, not re-engaged recently)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    let reEngaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        // Check we haven't already sent a re-engage message
        const { data: recentOutbound } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1)
          .single();

        if (recentOutbound) continue;

        const hinglish = isHinglish(detectMarket(lead.phone));
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          bodyValues: hinglish
            ? [lead.name || 'there']
            : [lead.name || 'there'],
        });
        reEngaged++;
      }
    }

    // Nudge clients who haven't submitted check-ins (+24hrs, +48hrs)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const sunday = new Date();
    sunday.setDate(sunday.getDate() - sunday.getDay());
    sunday.setHours(3, 30, 0, 0); // 9am IST = 3:30 UTC

    if (Date.now() - sunday.getTime() > 24 * 60 * 60 * 1000) {
      const { data: activeClients } = await supabase
        .from('clients')
        .select('*')
        .eq('status', 'active');

      if (activeClients) {
        for (const client of activeClients) {
          const started = new Date(client.program_started_at);
          const weekNo = Math.ceil((Date.now() - started.getTime()) / (7 * 24 * 60 * 60 * 1000));

          const { data: checkin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();

          if (!checkin) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
            await sendWhatsApp({
              phone: client.phone,
              templateName: 'checkin_nudge',
              bodyValues: [client.name || 'there', checkinUrl],
            });
          }
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
