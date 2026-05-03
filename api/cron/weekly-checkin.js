const { getSupabase } = require('../../lib/supabase');
const { canSendMessage, sendTemplate, logMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', results });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        // Check if program has ended
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          results.skipped++;
          continue;
        }

        // Check if check-in already submitted this week
        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        // Send check-in form link
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = client.leads?.market || 'GLOBAL';
        const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder';

        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);
        await logMessage(client.phone, 'out', null, templateName);
        results.sent++;

      } catch (clientErr) {
        console.error(`Check-in send failed for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
