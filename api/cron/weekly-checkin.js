const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db.from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const { count: missedCount } = await db.from('checkins')
          .select('id', { count: 'exact' })
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .lte('week_no', weekNo - 1);

        if (missedCount !== null && (weekNo - 1) - missedCount >= 2) {
          const { notifyMaddy } = require('../../lib/whatsapp');
          await notifyMaddy(
            '2 Consecutive Missed Check-ins',
            `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nWeek: ${weekNo}`
          );
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const templateName = market === 'IN' ? 'weekly_checkin_hindi' : 'weekly_checkin';

        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl
        ]);

        sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for client ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    return res.status(200).json({ sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
