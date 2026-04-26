const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { logMessage } = require('../_lib/rate-limit');
const { json, maskPhone } = require('../_lib/helpers');

const MADDY_PHONE = '917082478374';
const SITE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return json(res, 200, { action: 'no_active_clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { data: prevCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missedCount = prevCheckins
        ? Math.max(0, weekNo - 1 - (prevCheckins[0]?.week_no || 0))
        : 0;

      if (missedCount >= 2) {
        await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
          maskPhone(client.phone),
          `${client.name || 'Client'} has missed ${missedCount} consecutive check-ins (Week ${weekNo}).`,
        ]);
      }

      const checkinUrl = `${SITE}/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);
      await logMessage(client.phone, 'out', `Week ${weekNo} check-in form sent`, 'weekly_checkin');

      results.push({ client_id: client.id, week_no: weekNo, action: 'sent' });
    }

    return json(res, 200, { action: 'weekly_checkin_done', results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return json(res, 500, { error: 'Cron failed' });
  }
};
