const { getSupabase } = require('../../lib/supabase');
const { sendText, notifyMaddy } = require('../../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();

    // Get all active clients
    const { data: clients } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.json({ sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    let missed2 = [];

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      // Check if this week's check-in already submitted
      const { data: existing } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await sb
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        missed2.push(client);
      }

      // Send check-in form link
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 📋\n\n` +
          `Week ${weekNo} check-in ka time hai!\n\n` +
          `Apna weight, waist, compliance score aur photos submit karo:\n` +
          `${checkinUrl}\n\n` +
          `Ye form bharna zaroori hai taaki hum tumhara program update kar sakein. 💪`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'there'}! 📋\n\n` +
          `It's time for your Week ${weekNo} check-in!\n\n` +
          `Submit your weight, waist, compliance score and progress photos:\n` +
          `${checkinUrl}\n\n` +
          `This helps us keep your program optimized. 💪`
        );
      }

      sent++;
    }

    // Escalate clients with 2+ missed check-ins
    for (const client of missed2) {
      await notifyMaddy(
        `⚠️ 2+ missed check-ins: ${client.name || maskPhone(client.phone)}\n` +
        `Program: ${client.program}\nPhone: ${maskPhone(client.phone)}`
      );
    }

    return res.json({ sent, total_clients: clients.length, escalated: missed2.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
