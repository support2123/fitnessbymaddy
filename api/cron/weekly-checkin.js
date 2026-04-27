const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ message: 'No active clients', ...results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const endDate = new Date(client.program_ends_at);
        if (now > endDate) continue;

        const { data: existingCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (existingCheckin) continue;

        const { data: missedCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(3);

        const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
        let consecutiveMissed = 0;
        for (let w = currentWeek - 1; w >= 1 && consecutiveMissed < 3; w--) {
          if (!submittedWeeks.includes(w)) consecutiveMissed++;
          else break;
        }

        if (consecutiveMissed >= 2) {
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `Client ${client.name || client.id}, program: ${client.program}, missed ${consecutiveMissed} weeks`
          );
          results.escalated++;
        }

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        const msg = hinglish
          ? [client.name || 'there', currentWeek.toString(), checkinUrl]
          : [client.name || 'there', currentWeek.toString(), checkinUrl];

        await sendWhatsApp(client.phone, 'weekly_checkin', msg);
        results.sent++;

        scheduleNudges(client, currentWeek, checkinUrl, hinglish);
      } catch (clientErr) {
        console.error(`[weekly-checkin] Error for client ${client.id}:`, clientErr.message);
        results.errors++;
      }
    }

    return res.json({ message: 'Weekly check-in complete', ...results });
  } catch (err) {
    console.error('[weekly-checkin]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function scheduleNudges(client, weekNo, checkinUrl, hinglish) {
  const nudge24h = setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!data) {
        await sendWhatsApp(client.phone, 'checkin_nudge', [
          client.name || 'there',
          weekNo.toString(),
          checkinUrl,
        ]);
      }
    } catch (e) {
      console.error('[nudge-24h]', e.message);
    }
  }, 24 * 60 * 60 * 1000);

  const nudge48h = setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!data) {
        await sendWhatsApp(client.phone, 'checkin_nudge_final', [
          client.name || 'there',
          weekNo.toString(),
          checkinUrl,
        ]);
      }
    } catch (e) {
      console.error('[nudge-48h]', e.message);
    }
  }, 48 * 60 * 60 * 1000);

  if (typeof nudge24h === 'object') nudge24h.unref?.();
  if (typeof nudge48h === 'object') nudge48h.unref?.();
}
