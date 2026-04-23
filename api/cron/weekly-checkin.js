const { supabase } = require('../_lib/supabase');
const { maskPhone } = require('../_lib/helpers');
const { sendText, notifyMaddy } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ status: 'ok', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo - 1, 2);
      const actualCheckins = missedCount || 0;

      if (expectedCheckins >= 2 && actualCheckins === 0) {
        await supabase.from('escalations').insert({
          phone: client.phone,
          reason: '2_consecutive_missed_checkins',
          message_body: `Client ${maskPhone(client.phone)} missed 2+ consecutive check-ins (week ${weekNo})`
        });
        await notifyMaddy('2 Missed Check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nCurrent week: ${weekNo}`);
        escalated++;
      }

      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const msg = `Hey ${client.name || 'there'}! 🏋️ Time for your Week ${weekNo} check-in.\n\nSubmit here: ${formUrl}\n\nWeight, waist, energy level + 3 progress photos. Takes 2 min!`;

      await sendText(client.phone, msg);
      sent++;
    }

    console.log(`[Cron:WeeklyCheckin] Sent ${sent}, escalated ${escalated}`);
    return res.json({ status: 'ok', sent, escalated });
  } catch (err) {
    console.error('[Cron:WeeklyCheckin Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
