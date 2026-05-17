const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../_lib/market');
const { notifyMaddy } = require('../_lib/whatsapp');

const SITE = process.env.SITE_URL || 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalations = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
      if (endDate && now > endDate) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = weekNo - 1; w >= 1 && consecutiveMissed < 3; w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 Missed Check-ins',
          `${client.name || maskPhone(client.phone)} has missed ${consecutiveMissed} consecutive check-ins.`
        );
        escalations++;
      }

      const checkinUrl = `${SITE}/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder_en';

      await sendTemplate(client.phone, templateName, [client.name || 'there', String(weekNo), checkinUrl], client.name);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, total_clients: clients.length, escalations });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
