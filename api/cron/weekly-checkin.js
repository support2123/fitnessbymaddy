const { getClient } = require('../../lib/supabase');
const { sendTextMessage } = require('../../lib/whatsapp');
const { logMessage, notifyMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/utils');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

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

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = missedCheckins?.map(c => c.week_no) || [];
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1 && w >= currentWeek - 3; w--) {
        if (!submittedWeeks.includes(w)) {
          consecutiveMissed++;
        } else {
          break;
        }
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)} — ${consecutiveMissed} weeks missed`
        );
      }

      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarketFromPhone(client.phone);

      const msg = market === 'IN'
        ? `📊 *Week ${currentWeek} Check-in Time!*\n\nHi ${client.name || 'there'}! Apni weekly progress share karo:\n\n${formUrl}\n\n5 min lagenge — weight, waist, aur photos upload karo. 💪`
        : `📊 *Week ${currentWeek} Check-in Time!*\n\nHi ${client.name || 'there'}! Time to share your weekly progress:\n\n${formUrl}\n\nTakes 5 mins — update your weight, waist, and upload photos. 💪`;

      await sendTextMessage(client.phone, msg);
      await logMessage(db, client.phone, 'out', msg, 'weekly_checkin');

      results.push({ client_id: client.id, week: currentWeek });
    }

    return res.status(200).json({
      success: true,
      sent: results.length,
      clients: results,
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectMarketFromPhone(phone) {
  if (!phone) return 'GLOBAL';
  if (phone.startsWith('91')) return 'IN';
  if (phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}
