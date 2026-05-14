const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('created_at', oneDayAgo)
      .is('program_interest', null);

    // Nudge check-in: clients who haven't submitted after 24h
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let nudged = 0;

    for (const client of (activeClients || [])) {
      const weekNo = calculateWeekNo(client.program_started_at);
      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (weekNo > maxWeeks) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (checkin) continue;

      const daysSinceSunday = getDaysSinceLastSunday();
      if (daysSinceSunday === 1 || daysSinceSunday === 2) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', {
          name: client.name || 'Champion',
          templateParams: [
            `Reminder: Your Week ${weekNo} check-in is still pending! Quick 2-min form: ${checkinUrl}`
          ]
        }, true).catch(() => {});
        nudged++;
      }

      // 2 consecutive missed check-ins → escalate
      if (weekNo >= 2) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .maybeSingle();

        if (!prevCheckin && daysSinceSunday >= 3) {
          await notifyMaddy(
            '2 missed check-ins',
            `Client: ${client.name} (${maskPhone(client.phone)})\nMissed weeks: ${weekNo - 1} and ${weekNo}\nProgram: ${client.program}`
          );
        }
      }
    }

    return res.json({ success: true, nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'cron failed' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  return Math.ceil((now - start) / (7 * 24 * 60 * 60 * 1000));
}

function getDaysSinceLastSunday() {
  const now = new Date();
  return now.getDay() || 7;
}
