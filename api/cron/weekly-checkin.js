const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { isHinglish, maskPhone } = require('../_lib/market');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;
    const now = new Date();

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = client.leads?.market || 'GLOBAL';
      const templateName = isHinglish(market) ? 'weekly_checkin' : 'weekly_checkin_en';

      const success = await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        `${weekNo}`,
        checkinUrl
      ], client.name);

      if (success) sent++;
      else errors++;
    }

    const twoMissed = await checkConsecutiveMissed(db);
    for (const client of twoMissed) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${maskPhone(client.phone)} | ${client.name || 'Unknown'} | Program: ${client.program}`
      );
    }

    return res.status(200).json({ sent, errors, missed_escalations: twoMissed.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function checkConsecutiveMissed(db) {
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  const flagged = [];
  const now = new Date();

  for (const client of (activeClients || [])) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 3) continue;

    const { data: checkins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .in('week_no', [currentWeek - 1, currentWeek - 2]);

    if (!checkins || checkins.length === 0) {
      flagged.push(client);
    }
  }

  return flagged;
}
