const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengagement')
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      const canSend = await canSendMessage(lead.phone, false);
      if (!canSend) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const body = hinglish
        ? `Hey ${lead.name || 'there'}! Maddy ka $20 Zoom trial abhi available hai. Ek session mein pata chalega kya aapke liye sahi hai. Book karo: https://fitnessbymaddy.com/shred.html`
        : `Hey ${lead.name || 'there'}! Maddy's $20 Zoom trial is still available. One session to see if it's right for you. Book here: https://fitnessbymaddy.com/shred.html`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengagement',
        body,
        params: [lead.name || 'there']
      });

      nudged++;
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        const nudgeDays = dayOfWeek === 1 ? '24hr' : '48hr';
        const body = hinglish
          ? `Reminder: Week ${weekNo} check-in abhi tak pending hai. Jaldi fill karo taaki aapka next plan ready ho sake:\n\n${checkinUrl}`
          : `Reminder: Your Week ${weekNo} check-in is still pending. Submit it so we can prepare your next plan:\n\n${checkinUrl}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: `checkin_nudge_${nudgeDays}`,
          body,
          params: [client.name, String(weekNo)]
        });

        checkinNudged++;
      }
    }

    return res.status(200).json({ ok: true, nudged, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
