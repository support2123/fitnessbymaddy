const { supabase, maskPhone } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { checkMissedCheckins } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Fetch clients error:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of (clients || [])) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      if (weeksElapsed < 1) continue;

      const programEnds = new Date(client.program_ends_at);
      if (Date.now() > programEnds.getTime()) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      const currentWeek = weeksElapsed;
      const hasCurrentCheckin = lastCheckin && lastCheckin.week_no === currentWeek;

      if (!hasCurrentCheckin) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        if (lastCheckin) {
          const daysSinceCheckin = Math.floor(
            (Date.now() - new Date(lastCheckin.form_submitted_at).getTime()) / (24 * 60 * 60 * 1000)
          );

          if (daysSinceCheckin >= 9) {
            await sendTemplate(client.phone, 'checkin_nudge_48h', [
              client.name || 'there',
              currentWeek.toString(),
              checkinUrl
            ]);
            nudged++;
          } else if (daysSinceCheckin >= 8) {
            await sendTemplate(client.phone, 'checkin_nudge_24h', [
              client.name || 'there',
              currentWeek.toString(),
              checkinUrl
            ]);
            nudged++;
          }
        }

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          currentWeek.toString(),
          checkinUrl
        ]);
        sent++;
      }

      await checkMissedCheckins(client.id, client.phone);
    }

    console.log(`Weekly check-in cron: ${sent} sent, ${nudged} nudged`);
    return res.json({ ok: true, sent, nudged, total_clients: (clients || []).length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
