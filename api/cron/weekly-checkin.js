const { getSupabase } = require('../lib/supabase');
const { sendTemplateForced } = require('../lib/whatsapp');
const { isHinglishMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: 'No active clients' });
    }

    let sent = 0;
    const errors = [];

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > maxWeeks) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existingCheckin) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        const { data: lead } = await db
          .from('leads')
          .select('market')
          .eq('phone', client.phone)
          .single();

        const market = lead?.market || 'GLOBAL';
        const templateName = isHinglishMarket(market) ? 'weekly_checkin_hi' : 'weekly_checkin';

        await sendTemplateForced(client.phone, templateName, {
          name: client.name || 'there',
          templateParams: [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]
        });

        sent++;
      } catch (clientErr) {
        errors.push({ client_id: client.id, error: clientErr.message });
      }
    }

    return res.status(200).json({
      ok: true,
      total_clients: activeClients.length,
      sent,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
