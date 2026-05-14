const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { escalateMissedCheckins } = require('../_lib/escalation');
const { isHinglish } = require('../_lib/market');
const { maskPhone } = require('../_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
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
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .maybeSingle();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = new Set((missedCheckins || []).map(c => c.week_no));
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1 && w >= currentWeek - 3; w--) {
        if (!submittedWeeks.has(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await escalateMissedCheckins(client.id, client.phone, consecutiveMissed);
        nudged++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = client.leads?.market || 'IN';

      if (isHinglish(market)) {
        await sendTemplate(client.phone, 'checkin_reminder_hi', [
          client.name || 'Champion',
          String(currentWeek),
          checkinUrl
        ]);
      } else {
        await sendTemplate(client.phone, 'checkin_reminder_en', [
          client.name || 'Champion',
          String(currentWeek),
          checkinUrl
        ]);
      }

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${currentWeek}`);
    }

    return res.status(200).json({ ok: true, sent, nudged, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
