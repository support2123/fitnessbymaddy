const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');
const { maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getClient();

    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: lead } = await db
        .from('leads')
        .select('market')
        .eq('id', client.lead_id)
        .single();

      const market = lead?.market || 'GLOBAL';
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const templateName = isHinglish(market) ? 'weekly_checkin' : 'weekly_checkin_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      if (weekNo >= 3 && (missedCount || 0) === 0) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          detail: `Client ${client.name || client.id}, program ${client.program}, week ${weekNo}`,
        });
      }

      results.push({ client_id: client.id, week_no: weekNo });
    }

    return res.json({ success: true, sent: results.length, results });
  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
