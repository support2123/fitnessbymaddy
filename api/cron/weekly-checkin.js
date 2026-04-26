const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { notifyMaddy } = require('../_lib/escalation');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sb = getSupabase();
    const { data: clients } = await sb
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / 86400000);
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await sb
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: missedWeeks } = await sb
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = missedWeeks && missedWeeks.length > 0 ? missedWeeks[0].week_no : 0;
      const missedConsecutive = weekNo - lastCheckinWeek - 1;

      if (missedConsecutive >= 2) {
        await notifyMaddy('2_missed_checkins', {
          client_name: client.name,
          phone: client.phone,
          missed_weeks: missedConsecutive
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? [`Hey ${client.name || 'there'}! Week ${weekNo} check-in time ✅ Apna progress share karo: ${checkinUrl}`]
        : [`Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in ✅ Share your progress here: ${checkinUrl}`];

      await sendTemplate(client.phone, 'weekly_checkin', msg);
      sent++;
    }

    return res.status(200).json({ sent, escalated, total_clients: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
