const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { notifyMaddy, maskPhone } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  // Verify this is a Vercel cron call
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const started = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - started) / (7 * 24 * 60 * 60 * 1000));

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await db.from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        skipped++;
        continue;
      }

      // Check if already submitted this week
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: lastCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastWeek = lastCheckins?.[0]?.week_no || 0;
      if (weekNo - lastWeek >= 3) {
        await notifyMaddy(
          '2+ missed check-ins',
          maskPhone(client.phone),
          `${client.name || 'Client'} — last check-in was week ${lastWeek}, now week ${weekNo}`
        );
        escalated++;
      }

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({
      action: 'weekly_checkin_sent',
      sent,
      skipped,
      escalated,
      total: clients.length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
