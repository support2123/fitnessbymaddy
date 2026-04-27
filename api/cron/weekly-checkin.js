const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, sendRateLimited } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone, detectMarket } = require('../_lib/phone');

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', processed: 0 });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
      if (endDate && now > endDate) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: latestCheckin } = await supabase
        .from('checkins')
        .select('*')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      if (latestCheckin && latestCheckin.week_no >= currentWeek) {
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckinWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = currentWeek - lastCheckinWeek - 1;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${maskPhone(client.phone)}\nProgram: ${client.program}\nMissed weeks: ${consecutiveMissed}`
        );
        escalated++;
      }

      const market = detectMarket(client.phone);
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      const isIN = market === 'IN';
      const params = isIN
        ? [`Week ${currentWeek} check-in time! Apna progress share karo: ${checkinUrl}`]
        : [`Week ${currentWeek} check-in time! Share your progress: ${checkinUrl}`];

      await sendTemplate(client.phone, 'weekly_checkin', params);
      sent++;

      if (latestCheckin) {
        const lastSubmit = new Date(latestCheckin.form_submitted_at);
        const hoursSinceSubmit = (now - lastSubmit) / (1000 * 60 * 60);

        if (hoursSinceSubmit > 24 && hoursSinceSubmit <= 48) {
          const nudgeParams = isIN
            ? [`Reminder: Week ${currentWeek - 1} ka check-in abhi bhi pending hai. Jaldi submit karo! ${checkinUrl}`]
            : [`Reminder: Your Week ${currentWeek - 1} check-in is still pending. Submit now: ${checkinUrl}`];
          await sendRateLimited(client.phone, 'checkin_nudge', nudgeParams);
          nudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      processed: activeClients.length,
      sent,
      nudged,
      escalated
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
