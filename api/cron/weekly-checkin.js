const { getSupabase } = require('../lib/supabase');
const { sendTemplateForced } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const client of activeClients) {
      const weekNo = calculateWeekNumber(client.program_started_at);
      if (weekNo < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplateForced(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]
      });
      sent++;
    }

    return res.status(200).json({ ok: true, sent, total: activeClients.length });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNumber(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil((diffDays + 1) / 7);
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
