const { getSupabase } = require('../_lib/supabase');
const { sendText } = require('../_lib/whatsapp');
const { escalateMissedCheckins } = require('../_lib/escalation');
const { detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  // Verify Vercel cron secret
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      // Check if checkin already exists for this week
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) continue;

      // Check for consecutive missed check-ins
      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      const missedCount = currentWeek - lastCheckinWeek - 1;

      if (missedCount >= 2) {
        await escalateMissedCheckins(client.id, client.phone, missedCount);
        nudged++;
      }

      // Send check-in form link
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const isHinglish = market === 'IN';

      let msg;
      if (isHinglish) {
        msg = `Hey ${client.name || 'there'}! 📊\n\nWeek ${currentWeek} ka check-in time hai!\n\nApna weight, waist measurement, aur progress photos submit karo:\n${checkinUrl}\n\n5 min lagega — tumhare results ke liye bahut important hai! 💪`;
      } else {
        msg = `Hey ${client.name || 'there'}! 📊\n\nTime for your Week ${currentWeek} check-in!\n\nSubmit your weight, waist measurement, and progress photos:\n${checkinUrl}\n\nTakes 5 mins — it's essential for your results! 💪`;
      }

      await sendText(client.phone, msg, true);
      sent++;
    }

    return res.status(200).json({
      action: 'weekly_checkin_sent',
      total_clients: clients.length,
      sent,
      escalated: nudged
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
