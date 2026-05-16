const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinLink = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weekNo), checkinLink]
      });

      sent++;
    }

    return res.status(200).json({ success: true, sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}
