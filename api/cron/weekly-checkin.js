const supabase = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');
const { detectMarket } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch clients:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients || []) {
      const weeksSinceStart = Math.floor(
        (Date.now() - new Date(client.program_started_at).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksSinceStart < 1) { skipped++; continue; }

      const weekNo = weeksSinceStart;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) { skipped++; continue; }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const template = market === 'IN' ? 'weekly_checkin_hindi' : 'weekly_checkin';

      await sendTemplate(client.phone, template, [
        client.name || 'Champion',
        String(weekNo),
        checkinUrl
      ], true);

      sent++;
      await checkMissedCheckins(client.id);
    }

    return res.status(200).json({ success: true, sent, skipped, total: (clients || []).length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
