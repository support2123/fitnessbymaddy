const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalate');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('id, phone, name, program, program_started_at')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = [];

  for (const client of activeClients) {
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

    const { count: missedCount } = await db
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id);

    const expectedCheckins = weekNo - 1;
    const consecutiveMissed = expectedCheckins - (missedCount || 0);

    if (consecutiveMissed >= 2) {
      await escalateToMaddy('2 consecutive missed check-ins', {
        phone: client.phone,
        name: client.name,
        message: `${client.name} has missed ${consecutiveMissed} consecutive check-ins.`,
      });
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    const market = detectMarket(client.phone);
    const template = market === 'IN' ? 'weekly_checkin_hi' : 'weekly_checkin_en';

    await sendWhatsApp(client.phone, template, [
      client.name || 'there',
      String(weekNo),
      checkinUrl,
    ]);

    results.push({ client_id: client.id, week_no: weekNo, status: 'sent' });
  }

  return res.status(200).json({
    action: 'weekly_checkins_sent',
    count: results.length,
    results,
  });
};
