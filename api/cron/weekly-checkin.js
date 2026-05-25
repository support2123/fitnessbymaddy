const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/rate-limit');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ ok: true, sent: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const programWeeks = client.program === '12wk' ? 12 : 6;
    if (currentWeek > programWeeks) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1);

    if (existingCheckin && existingCheckin.length > 0) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastTwoWeeks = [currentWeek - 1, currentWeek - 2];
    const submittedWeeks = (missedCheckins || []).map((c) => c.week_no);
    const consecutiveMisses = lastTwoWeeks.filter(
      (w) => w > 0 && !submittedWeeks.includes(w)
    ).length;

    if (consecutiveMisses >= 2) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        client.phone,
        `Client ${client.name || client.id} missed weeks ${lastTwoWeeks.join(', ')}`
      );
      escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(currentWeek),
      checkinUrl,
    ]);
    await logMessage(client.phone, 'out', `Week ${currentWeek} check-in request`, 'weekly_checkin');
    sent++;
  }

  return res.status(200).json({ ok: true, sent, escalated });
};
