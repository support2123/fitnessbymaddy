const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends Authorization header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      // Check if program has ended
      if (client.program_ends_at && new Date(client.program_ends_at) < now) {
        continue;
      }

      // Check if this week's check-in already exists
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckedWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckedWeek >= 3) {
        await escalateToMaddy(
          '2+ consecutive missed check-ins',
          `Client ${client.id} (${maskPhone(client.phone)}), last check-in: week ${lastCheckedWeek}, current: week ${weekNo}`
        );
        escalated++;
      }

      // Send check-in form link
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? [`Hey ${client.name || 'there'}! 📋 Week ${weekNo} check-in time! Form fill karo:\n${checkinUrl}\n\nPhotos + measurements zaroor add karna 💪`]
        : [`Hey ${client.name || 'there'}! 📋 Time for your Week ${weekNo} check-in!\n${checkinUrl}\n\nDon't forget to add photos + measurements 💪`];

      await sendWhatsApp(client.phone, 'weekly_checkin', params);
      sent++;
    }

    return res.status(200).json({
      action: 'weekly_checkin_sent',
      total_clients: clients.length,
      sent,
      escalated,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
