const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ action: 'no_active_clients' });
  }

  const results = [];

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    const maxWeeks = client.program === '12wk' ? 12 : 6;
    if (weekNo > maxWeeks) {
      await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
      results.push({ client_id: client.id, action: 'completed' });
      continue;
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existing) {
      results.push({ client_id: client.id, action: 'already_submitted' });
      continue;
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    const lastSubmittedWeek = missedCheckins && missedCheckins.length > 0
      ? missedCheckins[0].week_no : 0;
    const consecutiveMissed = weekNo - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await notifyMaddy('2 consecutive missed check-ins', {
        phone: client.phone,
        info: `${client.name} has missed ${consecutiveMissed} check-ins`,
      });
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(weekNo),
      checkinUrl,
    ]);

    results.push({ client_id: client.id, action: 'checkin_sent', week_no: weekNo });
  }

  return res.status(200).json({ action: 'weekly_checkins_sent', count: results.length, results });
};
