const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const authHeader = req.headers.authorization || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && !isVercelCron && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // NUDGE 1: New leads with no reply after 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await db
      .from('leads')
      .select('*, messages:messages(direction, sent_at)')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of (staleNew || [])) {
      const inbound = (lead.messages || []).filter(m => m.direction === 'in');
      const outbound = (lead.messages || []).filter(m => m.direction === 'out');

      if (inbound.length <= 1 && outbound.length <= 1) {
        const hinglish = isHinglish(lead.market);
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: hinglish
            ? `Hey! 👋 Maddy ka $20 trial Zoom session try karo — pehle feel lo, phir decide karo. Sirf 1 hour mein samajh aa jayega.\n\nhttps://fitnessbymaddy.com/program-trial.html`
            : `Hey! 👋 Try Maddy's $20 trial Zoom session — feel it out, then decide. Just 1 hour to see if this is for you.\n\nhttps://fitnessbymaddy.com/program-trial.html`,
          params: [lead.name || 'there']
        });
        nudged++;
      }
    }

    // NUDGE 2: Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    for (const lead of (deadLeads || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('direction')
        .eq('phone', lead.phone)
        .eq('direction', 'in');

      if (!msgs || msgs.length <= 1) {
        await db.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // NUDGE 3: Check-in reminders for clients (+24h, +48h)
    let checkinNudged = 0;
    const { data: pendingClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (pendingClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));
      const dayOfWeek = now.getDay();

      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const nudgeDay = dayOfWeek === 1 ? '+24h' : '+48h';

      await sendWhatsApp({
        phone: client.phone,
        body: `Reminder: Your Week ${weekNo} check-in is still pending! 📋\n\n${checkinUrl}\n\nQuick 5-min form so Maddy can update your plan.`
      });
      checkinNudged++;
    }

    // NUDGE 4: Re-engage dropped leads after 7 days (one-time)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    let reengaged = 0;

    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    for (const lead of (reengageLeads || [])) {
      const hinglish = isHinglish(lead.market);
      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        body: hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ne ek special offer rakha hai tere liye — $20 trial session, no commitment. Interested? Reply karo! 💪`
          : `Hey ${lead.name || 'there'}! Maddy has a special offer for you — $20 trial session, no commitment. Interested? Just reply! 💪`,
        params: [lead.name || 'there']
      });
      reengaged++;
    }

    return res.json({ ok: true, nudged, dropped, checkinNudged, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
