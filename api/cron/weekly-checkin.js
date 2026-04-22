const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ sent: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    if (weekNo < 1) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existingCheckin) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const missedCount = weekNo - (missedCheckins?.length || 0);
    if (missedCount >= 2) {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [client.name || 'Client', `${missedCount} consecutive missed check-ins`, `Client ID: ${client.id}`]
      );
      escalated++;
    }

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    const params = hinglish
      ? [client.name || 'there', `Week ${weekNo}`, checkinUrl]
      : [client.name || 'there', `Week ${weekNo}`, checkinUrl];

    const result = await sendWhatsApp(client.phone, 'weekly_checkin', params);
    if (result.ok) sent++;
  }

  return res.status(200).json({ sent, escalated, total: activeClients.length });
};
