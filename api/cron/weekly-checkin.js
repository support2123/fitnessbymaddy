const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify cron auth (Vercel sends this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Also allow if no CRON_SECRET is set (development)
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, skipped: 0, errors: 0 };

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', ...results });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const weekNo = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

        // Check if program has ended
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          results.skipped++;
          continue;
        }

        // Check if already submitted this week
        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) {
          results.skipped++;
          continue;
        }

        // Check for consecutive missed check-ins
        await checkMissedCheckins(client.id, client.phone);

        // Get lead for market info
        let market = 'GLOBAL';
        if (client.lead_id) {
          const { data: lead } = await db
            .from('leads')
            .select('market')
            .eq('id', client.lead_id)
            .single();
          market = lead?.market || 'GLOBAL';
        }

        // Send check-in form link
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';
        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);

        results.sent++;
      } catch (clientErr) {
        console.error(`Checkin send error for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
