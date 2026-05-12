const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ status: 'ok', sent: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);

        if (weekNo < 1) continue;

        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > maxWeeks) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existingCheckin) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const lang = market === 'IN' ? 'hinglish' : 'english';

        await sendWhatsApp(client.phone, 'weekly_checkin', {
          name: client.name,
          templateParams: [client.name, `${weekNo}`, checkinUrl],
        });

        sent++;
      } catch (err) {
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.status(200).json({ status: 'ok', sent, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil((diffDays + 1) / 7);
}
