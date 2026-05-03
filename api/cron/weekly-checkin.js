const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, maskPhone, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, { error: 'GET only' }, 405);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'unauthorized' }, 401);
  }

  try {
    const sb = getSupabase();
    const { data: clients } = await sb
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id, leads(market)')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return json(res, { ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: lastTwo } = await sb
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length === 0 && weekNo > 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${weekNo}\nProgram: ${client.program}`
        );
        escalated++;
      } else if (lastTwo && lastTwo.length >= 1) {
        const lastWeek = lastTwo[0].week_no;
        if (weekNo - lastWeek >= 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${weekNo}\nLast check-in: Week ${lastWeek}`
          );
          escalated++;
        }
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'IN';

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'Champion',
          String(weekNo),
          checkinUrl
        ], true);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name || 'Champion',
          String(weekNo),
          checkinUrl
        ], true);
      }

      sent++;
    }

    return json(res, { ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
