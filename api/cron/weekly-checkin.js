const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();

    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program', 'eq', 'zoom_trial');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const params = market === 'IN'
          ? [client.name || 'there', weekNo.toString(), checkinUrl]
          : [client.name || 'there', weekNo.toString(), checkinUrl];

        await sendWhatsApp(client.phone, 'weekly_checkin', params);
        sent++;
      } catch (err) {
        console.error(`Check-in send failed for client ${client.id}:`, err.message);
        errors++;
      }
    }

    return res.status(200).json({ status: 'done', sent, errors, total: clients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return diffWeeks + 1;
}

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
