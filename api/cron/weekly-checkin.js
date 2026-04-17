const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { weekNumber } = require('../_lib/helpers');
const { notifyMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    const results = [];

    for (const client of clients) {
      const week = weekNumber(client.program_started_at);
      const meta = require('../_lib/helpers').PROGRAM_META[client.program];

      if (meta && week > meta.weeks) {
        await db
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        results.push({ clientId: client.id, action: 'completed' });
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', week)
        .single();

      if (existing) {
        results.push({ clientId: client.id, action: 'already_submitted' });
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${week}`;
      const msg = `Week ${week} check-in time! 📋\n\nFill this out so we can prep your next week:\n${checkinUrl}`;

      await sendTemplate(client.phone, 'weekly_checkin', [msg]);
      results.push({ clientId: client.id, action: 'sent', week });

      const { data: prevMissed } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', week - 1)
        .single();

      const { data: prevPrevMissed } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', week - 2)
        .single();

      if (!prevMissed && !prevPrevMissed && week > 2) {
        await notifyMaddy('2 consecutive missed check-ins', {
          clientName: client.name,
          phone: client.phone,
          message: `Missed weeks ${week - 2} and ${week - 1}`,
        });
      }
    }

    return res.status(200).json({ processed: results.length, results });
  } catch (err) {
    console.error('[cron/weekly-checkin]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
