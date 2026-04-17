const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    let sent = 0;

    if (leads && leads.length > 0) {
      for (const lead of leads) {
        const canSend = await checkRateLimit(lead.phone);
        if (!canSend) continue;

        const msg =
          lead.market === 'IN'
            ? 'Hey! Maddy ka $20 trial session abhi bhi available hai — ek baar try karke dekho, koi commitment nahi 💪'
            : "Hey! Maddy's $20 trial session is still available — try it out, no commitment required 💪";

        await sendTemplate(lead.phone, 'nudge_trial', [msg]);
        sent++;
      }
    }

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    let reminders = 0;

    if (activeClients) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      for (const client of activeClients) {
        const { data: pendingCheckin } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'weekly_checkin')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (pendingCheckin && pendingCheckin.sent_at < oneDayAgo) {
          const canSend = await checkRateLimit(client.phone);
          if (!canSend) continue;

          const msg =
            'Reminder: Your weekly check-in is pending! Fill it out so we can update your program 📋';
          await sendTemplate(client.phone, 'checkin_reminder', [msg]);
          reminders++;
        }
      }
    }

    return res.status(200).json({
      nudged: sent,
      leadsTotal: leads ? leads.length : 0,
      reminders,
    });
  } catch (err) {
    console.error('[cron/nudge-dropped]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
