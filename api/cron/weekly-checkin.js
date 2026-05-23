const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.status(200).json({ message: 'No active clients' });
  }

  const results = [];

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
      .single();

    if (existingCheckin) {
      results.push({ client_id: client.id, week: currentWeek, status: 'already_submitted' });
      continue;
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    const lastSubmittedWeek = missedCheckins?.[0]?.week_no || 0;
    const consecutiveMissed = currentWeek - lastSubmittedWeek - 1;

    if (consecutiveMissed >= 2) {
      await escalateToMaddy({
        reason: '2_consecutive_missed_checkins',
        phone: client.phone,
        name: client.name,
        message: `${client.name} has missed ${consecutiveMissed} consecutive check-ins.`,
      });
    }

    const checkinLink = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

    await sendWhatsApp({
      phone: client.phone,
      message: `Hey ${client.name || 'there'}! Time for your Week ${currentWeek} check-in.\n\nFill it out here: ${checkinLink}\n\nIt takes just 2 minutes and helps us keep your plan on track!`,
    });

    results.push({ client_id: client.id, week: currentWeek, status: 'sent' });
  }

  return res.status(200).json({ ok: true, processed: results.length, results });
};
