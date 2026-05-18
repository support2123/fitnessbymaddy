const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { checkMissedCheckins } = require('../lib/escalation');
const { isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString())
      .gte('program_ends_at', new Date().toISOString());

    if (!activeClients?.length) {
      return res.status(200).json({ ok: true, message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const weeksActive = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weeksActive)
          .single();

        if (existingCheckin) continue;

        await checkMissedCheckins(client.id);

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weeksActive}`;
        const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weeksActive),
          checkinUrl
        ]);

        sent++;
      } catch (err) {
        console.error(`Check-in send error for client ${client.id}:`, err.message);
        errors++;
      }
    }

    return res.status(200).json({
      ok: true,
      total_clients: activeClients.length,
      sent,
      errors
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
