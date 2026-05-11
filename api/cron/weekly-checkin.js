const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      const expectedRecent = Math.min(weekNo - 1, 2);
      if (expectedRecent >= 2 && (missedCount === null || missedCount === 0)) {
        await sendEscalation(
          `2 consecutive missed check-ins: ${client.name || 'Unknown'} (${client.id})`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      await sendWhatsApp({
        phone: client.phone,
        templateName: hinglish ? 'weekly_checkin_hi' : 'weekly_checkin',
        params: [client.name || 'there', String(weekNo), checkinUrl],
      });

      sent++;
    }

    return res.json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
