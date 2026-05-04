const { supabase } = require('../lib/supabase');
const { sendRateLimitedToClient, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'POST' || req.headers['x-internal-key'] !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalations = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (24 * 60 * 60 * 1000));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo, 2);
      const actualCheckins = missedCount || 0;

      if (expectedCheckins - actualCheckins >= 2) {
        escalations++;
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${client.program})\nWeek: ${weekNo}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.phone.startsWith('+91') ? 'IN' : 'GLOBAL';

      const msg = market === 'IN'
        ? `Hey ${client.name || 'champion'}! 📋\n\nWeek ${weekNo} check-in time!\nYe form fill karo (2 min lagega):\n${checkinUrl}\n\nWeight, waist, photos + how you're feeling — sab daalo!`
        : `Hey ${client.name || 'champion'}! 📋\n\nWeek ${weekNo} check-in time!\nFill this quick form (2 min):\n${checkinUrl}\n\nWeight, waist, photos + how you're feeling — include it all!`;

      await sendRateLimitedToClient({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: { name: client.name, templateParams: [client.name || 'there', String(weekNo), checkinUrl] }
      });

      sent++;
    }

    return res.status(200).json({ success: true, sent, escalations, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
