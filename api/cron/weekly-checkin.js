const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglishMarket, getProgramWeeks } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers['x-vercel-cron'] !== '1') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: activeClients, error } = await supabase
    .from('clients')
    .select('id, phone, name, program, program_started_at')
    .eq('status', 'active');

  if (error || !activeClients) {
    console.error('Failed to fetch active clients:', error);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  const results = { sent: 0, skipped: 0, errors: 0 };

  for (const client of activeClients) {
    try {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const totalWeeks = getProgramWeeks(client.program);

      if (currentWeek > totalWeeks || currentWeek < 1) {
        results.skipped++;
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .maybeSingle();

      if (existingCheckin) {
        results.skipped++;
        continue;
      }

      const checkinLink = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const templateName = isHinglishMarket(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

      await sendTemplate(client.phone, templateName, [
        client.name || 'Champion',
        `${currentWeek}`,
        checkinLink,
      ]);

      results.sent++;
    } catch (err) {
      console.error(`Checkin send error for client ${client.id}:`, err.message);
      results.errors++;
    }
  }

  return res.status(200).json({ success: true, ...results });
};
