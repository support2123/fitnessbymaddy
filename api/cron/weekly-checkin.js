const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json, calculateWeekNo, detectMarket } = require('../../lib/utils');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal && req.method === 'GET') {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return json(res, { message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const templateName = market === 'IN' ? 'weekly_checkin_hinglish' : 'weekly_checkin';

      await sendWhatsApp(client.phone, templateName, {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weekNo), checkinUrl],
        body: `Time for your Week ${weekNo} check-in! Fill the form: ${checkinUrl}`
      });
      sent++;

      await checkMissedCheckins(client.id);

      const prevWeek = weekNo - 1;
      if (prevWeek > 0) {
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', prevWeek)
          .maybeSingle();

        if (!prevCheckin) {
          nudged++;
        }
      }
    }

    return json(res, { success: true, sent, nudged, total_clients: activeClients.length });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
