const { getSupabase } = require('../../lib/supabase');
const { sendTextMessage, sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    // Allow manual trigger without auth in dev
    if (process.env.NODE_ENV === 'production' && !req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', count: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const missedWeeks = lastCheckin
        ? currentWeek - lastCheckin.week_no - 1
        : currentWeek - 1;

      if (missedWeeks >= 2) {
        const { notifyMaddy } = require('../../lib/escalation');
        await notifyMaddy(
          '2 missed check-ins',
          `${client.name || client.phone} has missed ${missedWeeks} consecutive check-ins`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = client.phone.startsWith('+91') || client.phone.startsWith('91') ? 'IN' : 'GLOBAL';

      const msg = market === 'IN'
        ? `Hey ${client.name || 'there'}! 💪 Week ${currentWeek} check-in time!\n\nApna progress update karo — weight, measurements aur photos share karo taaki main tumhara next week ka plan adjust kar sakun.\n\n📝 ${checkinUrl}`
        : `Hey ${client.name || 'there'}! 💪 Time for your Week ${currentWeek} check-in!\n\nShare your progress — weight, measurements, and photos so I can adjust your plan.\n\n📝 ${checkinUrl}`;

      await sendTextMessage(client.phone, msg);
      sent++;
    }

    return res.status(200).json({
      success: true,
      clients_processed: activeClients.length,
      checkins_sent: sent,
      nudges_sent: nudged
    });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
