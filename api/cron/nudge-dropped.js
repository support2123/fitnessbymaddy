const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglishMarket, detectMarket } = require('../_lib/market');
const { maskPhone } = require('../_lib/mask');

const REENGAGEMENT_WINDOW_DAYS = 7;
const COOLOFF_DAYS = 3;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - REENGAGEMENT_WINDOW_DAYS);

    const cooloffDate = new Date();
    cooloffDate.setDate(cooloffDate.getDate() - COOLOFF_DAYS);

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', windowStart.toISOString())
      .lte('last_msg_at', cooloffDate.toISOString());

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to re-engage', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const lead of droppedLeads) {
      try {
        const { data: recentOutbound } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', cooloffDate.toISOString())
          .limit(1);

        if (recentOutbound && recentOutbound.length > 0) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglishMarket(market);

        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ka $20 trial session abhi available hai. Ek baar try karo, results dekho: https://www.fitnessbymaddy.com`
          : `Hey ${lead.name || 'there'}! Maddy's $20 trial session is still available. Give it a try and see the results for yourself: https://www.fitnessbymaddy.com`;

        const result = await sendWhatsApp(lead.phone, 'nudge_trial', {
          text: msg,
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });

        if (result.sent) sent++;
      } catch (err) {
        errors.push({ lead: maskPhone(lead.phone), error: err.message });
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of (pendingCheckins || [])) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay();

      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglishMarket(market);

      const nudgeMsg = hinglish
        ? `Reminder: Week ${weekNo} check-in pending hai! Fill karo: ${formUrl}`
        : `Reminder: Your Week ${weekNo} check-in is still pending! Fill it out here: ${formUrl}`;

      await sendWhatsApp(client.phone, null, {
        text: nudgeMsg,
        isClient: true,
        skipRateLimit: true
      });
      checkinNudges++;
    }

    console.log(`[Cron] Nudge: reengaged=${sent}, checkin_nudges=${checkinNudges}`);
    return res.status(200).json({ sent, checkinNudges, errors });
  } catch (err) {
    console.error('[Cron Nudge] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
