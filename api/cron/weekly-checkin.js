const { getSupabase } = require('../../lib/supabase');
const { sendTemplateForced, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ action: 'no_active_clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL');

      const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en';
      await sendTemplateForced(client.phone, templateName, {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weekNo), checkinUrl]
      });

      sent++;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const consecutiveMisses = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMisses && weekNo > 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || client.phone}\nProgram: ${client.program}\nWeek: ${weekNo}`
        );
      }
    }

    return res.status(200).json({ ok: true, sent, skipped, total: clients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
