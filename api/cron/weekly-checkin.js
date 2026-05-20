const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage, detectMarket } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: lastCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missedWeeks = lastCheckins
        ? currentWeek - 1 - (lastCheckins[0]?.week_no || 0)
        : currentWeek - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${maskPhone(client.phone)})\nWeek ${currentWeek}, last check-in: week ${lastCheckins?.[0]?.week_no || 'none'}`
        );
        escalated++;
      }

      const allowed = await canSendMessage(client.phone);
      if (!allowed) continue;

      const market = detectMarket(client.phone);
      const templateName = market === 'IN' ? 'weekly_checkin_hi' : 'weekly_checkin';

      await sendTemplate(client.phone, templateName, {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(currentWeek),
          `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`,
        ],
      });

      sent++;
    }

    return res.json({ ok: true, processed: activeClients.length, sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
