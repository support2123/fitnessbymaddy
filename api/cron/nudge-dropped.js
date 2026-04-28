const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    // Find leads dropped exactly 7 days ago (re-engage window)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    const { data: droppedLeads, error } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (error) throw error;
    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      // Check we haven't already sent a re-engagement
      const { data: recentOutbound } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (recentOutbound && recentOutbound.length > 0) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${lead.name || 'there'}! Maddy ka $20 trial abhi bhi available hai — ek Zoom session mein dekhoge results kaise milte hain.\n\nInterested? Reply "TRIAL" 💪`
        : `Hey ${lead.name || 'there'}! Maddy's $20 trial is still available — see real coaching in just one Zoom session.\n\nInterested? Reply "TRIAL" 💪`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        body: msg,
        params: [lead.name || 'there']
      });

      sent++;
    }

    // Also send nudges for pending check-ins (+24hrs and +48hrs)
    let checkinNudges = 0;

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: submitted } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (submitted && submitted.length > 0) continue;

        // Check day of week (Sunday = 0): nudge on Monday (+24h) and Tuesday (+48h)
        const dayOfWeek = now.getUTCDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const nudgeMsg = hinglish
          ? `Reminder: Week ${weekNo} check-in abhi bhi pending hai! Form fill karo so Maddy aapka next week plan bana sake.\n\nhttps://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`
          : `Reminder: Your Week ${weekNo} check-in is still pending! Fill it in so Maddy can prepare your next week's plan.\n\nhttps://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          body: nudgeMsg,
          params: [client.name || 'there', String(weekNo)]
        });

        checkinNudges++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      reengaged: sent,
      checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
