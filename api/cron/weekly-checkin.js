const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone, getLanguage, detectMarket } = require('../../lib/helpers');

// Runs every Sunday 9am IST (3:30 UTC) via Vercel Cron
module.exports = async function handler(req, res) {
  // Verify this is a cron call (Vercel sets this header)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  // Get all active clients
  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients || clients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = { sent: 0, skipped: 0, errors: 0 };

  for (const client of clients) {
    try {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const diffMs = now - startDate;
      const weekNo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));

      // Don't send if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        results.skipped++;
        continue;
      }

      // Check if already submitted this week
      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) {
        results.skipped++;
        continue;
      }

      // Send check-in form link
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const lang = getLanguage(market);

      const templateName = lang === 'hinglish' ? 'weekly_checkin_hi' : 'weekly_checkin_en';
      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl
      ]);

      results.sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} Week ${weekNo}`);
    } catch (err) {
      console.error(`Error sending check-in to ${maskPhone(client.phone)}:`, err.message);
      results.errors++;
    }
  }

  // Schedule nudges for clients who haven't submitted after 24h and 48h
  // (These will be handled by the nudge-dropped cron which runs daily)

  console.log(`Weekly check-in cron complete: ${JSON.stringify(results)}`);
  return res.status(200).json({ success: true, ...results });
};
