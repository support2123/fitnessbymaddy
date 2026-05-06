const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        await notifyMaddy(
          '2+ missed check-ins',
          `Client: ${client.name || client.phone}\nLast check-in: Week ${lastCheckinWeek}\nCurrent: Week ${weekNo}`
        );
        escalated++;
        continue;
      }

      // Send check-in form link
      const formUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.phone.startsWith('91') ? 'IN' : 'GLOBAL';
      const msg = market === 'IN'
        ? [`Hey ${client.name || ''}! Week ${weekNo} check-in time 📋\n\nYeh form fill karo: ${formUrl}\n\nWeight, waist, photos + how you're feeling.`]
        : [`Hey ${client.name || ''}! Week ${weekNo} check-in time 📋\n\nPlease fill this form: ${formUrl}\n\nWeight, waist, photos + how you're feeling.`];

      await sendTemplate(client.phone, 'weekly_checkin', msg);
      sent++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    return res.status(200).json({ success: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
