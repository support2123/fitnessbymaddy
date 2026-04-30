const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { checkConsecutiveMissed } = require('../../lib/escalation');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;

    for (const client of activeClients) {
      const weeksElapsed = Math.floor(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      const weekNo = weeksElapsed + 1;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      let { data: lead } = { data: null };
      if (client.lead_id) {
        const result = await supabase
          .from('leads')
          .select('market')
          .eq('id', client.lead_id)
          .single();
        lead = result.data;
      }

      const hinglish = lead && isHinglish(lead.market);

      const msg = hinglish
        ? `Week ${weekNo} check-in time! Apna progress update karo:\n${checkinUrl}`
        : `Week ${weekNo} check-in time! Update your progress:\n${checkinUrl}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      await checkConsecutiveMissed(supabase, client.id);
      sent++;
    }

    return res.status(200).json({ message: 'Check-ins sent', sent });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
