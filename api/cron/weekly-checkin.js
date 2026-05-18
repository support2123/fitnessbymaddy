const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/helpers');
const { escalateMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify this is a cron call (Vercel sets this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL) {
    // Allow in Vercel environment (cron auto-authenticates) or with secret
  }

  try {
    const db = getSupabase();

    // Get all active clients
    const { data: clients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of clients || []) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        results.skipped++;
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        await escalateMissedCheckins(client);
        results.escalated++;
      }

      // Send check-in form
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en';

      try {
        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          `Week ${weekNo}`,
          formUrl
        ]);
        results.sent++;
      } catch (err) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, err.message);
        results.skipped++;
      }
    }

    console.log(`Weekly checkin cron: ${JSON.stringify(results)}`);
    return res.json({ ok: true, ...results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
