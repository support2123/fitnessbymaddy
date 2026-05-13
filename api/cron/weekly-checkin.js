const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('Failed to fetch clients:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of clients || []) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existing) continue;

    const { data: lastTwoCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (lastTwoCheckins && lastTwoCheckins.length >= 2) {
      const expectedWeeks = [currentWeek - 1, currentWeek - 2];
      const submittedWeeks = lastTwoCheckins.map(c => c.week_no);
      const missedBoth = expectedWeeks.every(w => !submittedWeeks.includes(w));
      if (missedBoth) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          details: `${client.name || 'Client'} missed weeks ${currentWeek - 2} and ${currentWeek - 1}`
        });
        escalated++;
      }
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
    const market = detectMarket(client.phone);
    const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

    await sendTemplate(client.phone, templateName, [
      client.name || 'there',
      String(currentWeek),
      checkinUrl
    ]);

    sent++;
  }

  return res.status(200).json({ ok: true, sent, escalated, total_clients: clients?.length || 0 });
};
