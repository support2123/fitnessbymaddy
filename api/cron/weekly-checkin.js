const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const supabase = getClient();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const recentWeeks = (missedCheckins || []).map(c => c.week_no);
      const consecutiveMissed = [currentWeek - 1, currentWeek - 2]
        .filter(w => w > 0 && !recentWeeks.includes(w)).length;

      if (consecutiveMissed >= 2) {
        await notifyMaddy(supabase, '2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          client_name: client.name,
          missed_weeks: consecutiveMissed
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(supabase, client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        week: String(currentWeek),
        checkin_url: checkinUrl
      });

      sent++;
    }

    console.log(`Weekly check-in cron: sent=${sent}, escalated=${escalated}`);
    return res.status(200).json({ ok: true, sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
