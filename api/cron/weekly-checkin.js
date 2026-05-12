const { supabase } = require('../_lib/supabase');
const { sendWhatsApp, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = market === 'IN'
        ? [`Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Fill this out: ${checkinUrl}`]
        : [`Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in: ${checkinUrl}`];

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: msg
      }, true);

      sent++;
    }

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
