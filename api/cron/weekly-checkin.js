const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { weeksBetween } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalate');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  let sent = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const weekNo = weeksBetween(client.program_started_at, new Date()) + 1;

    if (weekNo > (client.program === '12wk' ? 12 : 6)) {
      await supabase
        .from('clients')
        .update({ status: 'completed' })
        .eq('id', client.id);
      continue;
    }

    const { data: existingCheckin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existingCheckin && existingCheckin.length > 0) continue;

    const { data: missedCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
    const missedConsecutive = weekNo - lastCheckedWeek - 1;

    if (missedConsecutive >= 2) {
      await escalateToMaddy('2 consecutive missed check-ins', {
        client_id: client.id,
        phone: client.phone,
        name: client.name,
        missed_weeks: missedConsecutive,
      }, { supabase });
      escalated++;
    }

    const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    await sendTemplate(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(weekNo),
      checkinUrl,
    ], { supabase });

    sent++;
  }

  return res.status(200).json({ ok: true, sent, escalated, total: activeClients.length });
};
