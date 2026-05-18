const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglishMarket } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await checkMissedCheckins(client.id);

      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglishMarket(market);
      const templateName = hinglish ? 'checkin_reminder_hi' : 'checkin_reminder_en';

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, templateName, [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl,
      ]);

      sent++;
    }

    return res.json({ success: true, sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'cron failed' });
  }
};
