const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours (new leads)
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    for (const lead of staleNewLeads || []) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Hey! \u{1F44B} Humara $20 Zoom trial try karo — full workout session Maddy ke saath. No commitment!\n\n\u{1F449} https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nBas ek session se samajh aa jayega!`
        : `Hey! \u{1F44B} Try our $20 Zoom trial — a full workout session with Maddy. No commitment!\n\n\u{1F449} https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nJust one session to see if it's for you!`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        params: [lead.name || 'there'],
        body
      });
    }

    // Drop leads with no reply in 24 hours
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo)
      .lt('created_at', twentyFourHoursAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      const expiredIds = expiredLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', expiredIds);
    }

    // Re-engage recently dropped leads (within 7 days, once only)
    const { data: recentlyDropped } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of recentlyDropped || []) {
      const { data: reEngageMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (reEngageMsg && reEngageMsg.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Hey ${lead.name || 'there'}! Maddy ke programs mein limited spots hain. Kuch bhi puchna ho toh yahan reply karo — hum help karenge! \u{1F4AA}`
        : `Hey ${lead.name || 'there'}! Limited spots available in Maddy's programs. Reply here if you have any questions — we're happy to help! \u{1F4AA}`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_dropped',
        params: [lead.name || 'there'],
        body
      });
      reEngaged++;
    }

    // Nudge clients with pending check-ins (24h + 48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const { data: nudgeMsg } = await supabase
        .from('messages')
        .select('id, sent_at')
        .eq('phone', client.phone)
        .eq('template_name', 'checkin_nudge')
        .order('sent_at', { ascending: false })
        .limit(1);

      const lastNudge = nudgeMsg?.[0]?.sent_at;
      if (lastNudge) {
        const hoursSinceNudge = (Date.now() - new Date(lastNudge).getTime()) / (60 * 60 * 1000);
        if (hoursSinceNudge < 24) continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Reminder! \u{1F4CB} Week ${weekNo} check-in abhi tak pending hai. Jaldi fill karo — isse next week ka plan better banega.\n\n\u{1F449} ${checkinUrl}`
        : `Reminder! \u{1F4CB} Your Week ${weekNo} check-in is still pending. Please fill it soon — it helps us make your next week's plan even better.\n\n\u{1F449} ${checkinUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'checkin_nudge',
        params: [client.name || 'there', String(weekNo)],
        body
      });
      clientNudges++;
    }

    return res.status(200).json({
      success: true,
      nudgedNewLeads: staleNewLeads?.length || 0,
      expiredLeads: expiredLeads?.length || 0,
      reEngaged,
      clientNudges
    });
  } catch (error) {
    console.error('Nudge cron error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
