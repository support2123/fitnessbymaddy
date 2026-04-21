const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients?.length) {
    return res.status(200).json({ message: 'No active clients', count: 0 });
  }

  let sent = 0;
  let errors = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existing?.length > 0) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
    const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await sendWhatsApp({
        phone: process.env.MADDY_PHONE || '+917082478374',
        templateName: 'escalation_alert',
        params: [client.name || client.phone, 'MISSED_CHECKINS', `${consecutiveMissed} consecutive missed`],
      });
    }

    try {
      const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || 'fitnessbymaddy.com';
      const formUrl = `https://${baseUrl}/checkin?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [client.name || 'there', String(weekNo), formUrl],
      });
      sent++;
    } catch (e) {
      console.error(`[CRON] Failed to send checkin to ${client.id}:`, e.message);
      errors++;
    }
  }

  return res.status(200).json({ message: 'Weekly check-ins sent', sent, errors, total: activeClients.length });
};
