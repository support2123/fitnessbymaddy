const { supabase } = require('../../lib/supabase');
const { sendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sets this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Fetch all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients || []) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      // Skip if program ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        skipped++;
        continue;
      }

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = isHinglish(market)
        ? `📊 Week ${weekNo} Check-in Time!\n\nApna progress track karo — weight, measurements aur photos submit karo:\n\n👉 ${checkinUrl}\n\nYeh form 5 min mein fill ho jayega!`
        : `📊 Week ${weekNo} Check-in Time!\n\nTrack your progress — submit your weight, measurements, and photos:\n\n👉 ${checkinUrl}\n\nTakes just 5 minutes!`;

      await sendMessage(client.phone, { text: msg, isClient: true });
      sent++;
    }

    return res.status(200).json({ ok: true, sent, skipped, total: (clients || []).length });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
