const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, status')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ action: 'no_active_clients' });
    }

    const results = [];

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
      const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `${client.name || 'Client'} — last submitted week ${lastSubmittedWeek}, current week ${weekNo}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const templateName = isHinglish(market) ? 'checkin_reminder_hi' : 'checkin_reminder';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        `Week ${weekNo}`,
        checkinUrl,
      ]);

      results.push({ client_id: client.id, week_no: weekNo, action: 'sent' });
    }

    return res.json({ success: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
