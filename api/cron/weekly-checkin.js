const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, escalated: 0, errors: 0 };

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', ...results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) {
          results.skipped++;
          continue;
        }

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1)
          .single();

        if (existingCheckin) {
          results.skipped++;
          continue;
        }

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
        const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

        if (consecutiveMissed >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `Client ${client.name || client.id} has missed ${consecutiveMissed} check-ins`
          );
          results.escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const market = client.leads?.market || 'GLOBAL';

        const msg = isHinglish(market)
          ? [`Hey ${client.name || ''}! Week ${currentWeek} ka check-in time hai. Apna progress share karo: ${checkinUrl}`]
          : [`Hey ${client.name || ''}! Time for your Week ${currentWeek} check-in. Share your progress: ${checkinUrl}`];

        await sendTemplate(client.phone, 'weekly_checkin', msg);
        results.sent++;

      } catch (clientErr) {
        console.error('Error processing client:', clientErr.message);
        results.errors++;
      }
    }

    return res.json({ message: 'Weekly check-in cron complete', ...results });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
