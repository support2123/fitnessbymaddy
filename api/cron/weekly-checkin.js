const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ processed: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existing) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const hinglish = isHinglish(client.market || 'GLOBAL');

        const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en';
        await sendTemplate(client.phone, templateName, [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ], true);

        sent++;
      } catch (clientErr) {
        console.error(`Checkin send failed for client ${client.id}:`, clientErr.message);
        errors++;
      }
    }

    await checkMissedCheckins(db);

    return res.status(200).json({ processed: clients.length, sent, errors });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / 86400000);
    const currentWeek = Math.floor(daysSinceStart / 7) + 1;

    if (currentWeek < 3) continue;

    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .gte('week_no', currentWeek - 2)
      .order('week_no', { ascending: false });

    if (!recentCheckins || recentCheckins.length === 0) {
      await notifyMaddy(
        `2 consecutive missed check-ins`,
        `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nWeek: ${currentWeek}`
      );
    }
  }
}
