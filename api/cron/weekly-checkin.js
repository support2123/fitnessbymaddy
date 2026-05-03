const { getSupabase } = require('../_lib/supabase');
const { sendClientMessage, notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/market');

module.exports = async function handler(req, res) {
  // Vercel cron sends GET requests
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Verify cron authorization
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const started = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - started) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        // Check if program has ended
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          results.skipped++;
          continue;
        }

        // Check if check-in already submitted this week
        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        // Send check-in form link
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        await sendClientMessage(client.phone, 'weekly_checkin', {
          name: client.name || 'there',
          templateParams: [
            client.name || 'there',
            String(currentWeek),
            checkinUrl
          ]
        });

        results.sent++;

        // Check for 2 consecutive missed check-ins
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const weekNums = (recentCheckins || []).map(c => c.week_no);
        if (currentWeek >= 3 && !weekNums.includes(currentWeek - 1) && !weekNums.includes(currentWeek - 2)) {
          await notifyMaddy(
            '2 Missed Check-ins',
            `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nWeek ${currentWeek}`
          );
        }
      } catch (clientErr) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
