const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id, form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin?.form_submitted_at) continue;

      if (!existingCheckin) {
        await db.from('checkins').insert({
          client_id: client.id,
          week_no: currentWeek,
        });
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ]);

      sent++;

      const { data: prevCheckins } = await db
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const missed = (prevCheckins || []).filter(
        c => c.week_no < currentWeek && !c.form_submitted_at
      );

      if (missed.length >= 2) {
        await db.from('escalations').insert({
          phone: client.phone,
          client_id: client.id,
          reason: 'consecutive_missed_checkins',
          message_body: `Missed ${missed.length} consecutive check-ins`,
        });

        const MADDY_PHONE = '+917082478374';
        const masked = client.phone.slice(0, 4) + 'XXX...' + client.phone.slice(-3);
        await sendText(MADDY_PHONE,
          `ALERT: Client ${client.name || masked} has missed ${missed.length} consecutive check-ins.`
        );
        nudged++;
      }
    }

    return res.status(200).json({ ok: true, sent, nudged, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
