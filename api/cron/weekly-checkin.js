const { getSupabase } = require('../lib/supabase');
const { sendTemplateForced } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  let sent = 0;
  let errors = 0;

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        await sendTemplateForced(client.phone, 'weekly_checkin', {
          name: client.name || 'there',
          templateParams: [
            client.name || 'there',
            weekNo.toString(),
            checkinUrl
          ]
        });

        sent++;
      } catch (clientErr) {
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        errors++;
      }
    }

    const { data: missedClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (missedClients) {
      for (const client of missedClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: allCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (allCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = currentWeek - 1; w >= 1 && consecutiveMissed < 2; w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          const { notifyMaddy } = require('../lib/escalation');
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${maskPhone(client.phone)} (${client.name || 'unknown'}), current week: ${currentWeek}`
          );
        }
      }
    }

    return res.status(200).json({ sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
