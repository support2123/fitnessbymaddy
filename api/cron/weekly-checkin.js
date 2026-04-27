const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, maskPhone } = require('../../lib/market');
const { createEscalation } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = getSupabase();

  try {
    // Get all active clients
    const { data: clients } = await sb
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await sb.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await sb
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        await createEscalation(
          client.phone,
          '2_consecutive_missed_checkins',
          `Client has not checked in since week ${lastCheckinWeek}. Current week: ${weekNo}`,
          client.id
        );
        escalated++;
      }

      // Send check-in form
      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(weekNo),
          formUrl,
        ],
      });

      sent++;
      console.log(`[CRON] Check-in sent: week ${weekNo} to ${maskPhone(client.phone)}`);
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error(`[CRON-CHECKIN] Error: ${err.message}`);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
