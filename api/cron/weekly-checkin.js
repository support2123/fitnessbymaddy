const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone, weeksBetween } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header)
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow internal calls too
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getClient();
  const now = new Date();

  // Get all active clients
  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', now.toISOString());

  if (error) {
    console.error('[CRON-CHECKIN]', error.message);
    return res.status(500).json({ error: error.message });
  }

  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const client of clients || []) {
    const weekNo = weeksBetween(client.program_started_at, now);

    // Check if already submitted this week
    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    // Check for 2 consecutive missed check-ins → escalate
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
    if (weekNo - lastCheckinWeek >= 3) {
      await sendTemplate(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', [
        maskPhone(client.phone),
        `2+ consecutive missed check-ins (last: week ${lastCheckinWeek}, current: week ${weekNo})`,
      ]);
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    try {
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);
      sent++;
      console.log(`[CRON-CHECKIN] Sent to ${maskPhone(client.phone)} week ${weekNo}`);
    } catch (err) {
      errors.push({ phone: maskPhone(client.phone), error: err.message });
    }
  }

  console.log(`[CRON-CHECKIN] Done: ${sent} sent, ${skipped} skipped, ${errors.length} errors`);

  return res.status(200).json({
    success: true,
    sent,
    skipped,
    errors: errors.length,
    total_clients: (clients || []).length,
  });
};
