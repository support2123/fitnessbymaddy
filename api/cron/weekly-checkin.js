const { getSupabase } = require('../../lib/supabase');
const { sendTemplateForced } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');
const { notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
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
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const maxWeeks = client.program === '12wk' ? 12 : 6;
      if (currentWeek > maxWeeks) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - 2); w--) {
        if (!submittedWeeks.includes(w)) consecutiveMissed++;
        else break;
      }

      if (consecutiveMissed >= 2) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: 'consecutive_missed_checkins',
          message_body: `${client.name || 'Client'} missed ${consecutiveMissed} consecutive check-ins (current week: ${currentWeek})`
        });
        await notifyMaddy('missed_checkins',
          `${client.name || 'Client'} has missed ${consecutiveMissed} consecutive check-ins. May need direct outreach.`);
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? [client.name || 'there', `Week ${currentWeek}`, checkinUrl]
        : [client.name || 'there', `Week ${currentWeek}`, checkinUrl];

      await sendTemplateForced(client.phone, 'weekly_checkin', params);
      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
