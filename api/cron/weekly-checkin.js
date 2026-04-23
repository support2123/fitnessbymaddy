const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalate } = require('../_lib/escalate');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}` &&
      !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  const { data: activeClients } = await db.from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', now.toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = { sent: 0, skipped: 0, escalated: 0 };

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) {
      results.skipped++;
      continue;
    }

    const { data: existingCheckin } = await db.from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existingCheckin) {
      results.skipped++;
      continue;
    }

    const { data: missedCheckins } = await db.from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
    const lastTwoMissed = weekNo >= 3 &&
      !submittedWeeks.includes(weekNo - 1) &&
      !submittedWeeks.includes(weekNo - 2);

    if (lastTwoMissed) {
      await escalate(
        client.phone,
        '2_consecutive_missed_checkins',
        `Client has missed check-ins for weeks ${weekNo - 2} and ${weekNo - 1}`,
        client.id
      );
      results.escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    const msg =
      `Hey ${client.name || 'there'}! \u{1F4CA}\n\n` +
      `It's Week ${weekNo} check-in time!\n\n` +
      `Fill out your progress form here:\n${checkinUrl}\n\n` +
      `Remember: weight, waist, compliance score + photos.\n` +
      `This helps us dial in your next week's program!\n\n` +
      `— Team Maddy`;

    await sendWhatsApp(client.phone, msg, 'weekly_checkin');
    results.sent++;
  }

  return res.status(200).json({ success: true, results });
};
