const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const maxWeeks = client.program === '12wk' ? 12 : 6;
        if (weekNo > maxWeeks) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);
          continue;
        }

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const templateName = hinglish ? 'checkin_reminder_hi' : 'checkin_reminder_en';

        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl,
        ], true);

        sent++;

        // Check for 2 consecutive missed check-ins
        const { data: lastTwo } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastCompletedWeek = lastTwo?.[0]?.week_no || 0;
        if (weekNo - lastCompletedWeek >= 3) {
          await escalateToMaddy(
            '2+ consecutive missed check-ins',
            client.phone,
            `${client.name || 'Client'} — last check-in was week ${lastCompletedWeek}, now week ${weekNo}`
          );
        }
      } catch (clientErr) {
        console.error(`[CRON-CHECKIN] Error for client ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    return res.json({ ok: true, sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('[CRON-CHECKIN ERROR]', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
