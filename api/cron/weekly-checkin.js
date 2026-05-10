const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService && req.method === 'POST') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ sent: 0 });
    }

    let sent = 0;
    const results = [];

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) continue;

      await checkMissedCheckins(client.id, client.phone);

      const { data: lead } = client.lead_id
        ? await supabase.from('leads').select('market').eq('id', client.lead_id).maybeSingle()
        : { data: null };

      const market = lead?.market || 'GLOBAL';
      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = isHinglish(market)
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time. Apna progress update karo - weight, photos, aur feel kaisa hai sab bata do!`
        : `Hey ${client.name || 'there'}! It's Week ${weekNo} check-in time. Update your progress - weight, photos, and how you're feeling!`;

      await sendTemplate(client.phone, 'weekly_checkin', [msg, formUrl]);
      sent++;
      results.push({ client_id: client.id, week_no: weekNo });
    }

    return res.json({ sent, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
