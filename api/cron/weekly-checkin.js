const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../lib/whatsapp');
const { jsonOk, jsonError, verifyCronSecret } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (!verifyCronSecret(req)) return jsonError(res, 'Unauthorized', 401);

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .not('program_started_at', 'is', null);

  if (!activeClients || activeClients.length === 0) {
    return jsonOk(res, { action: 'no_active_clients' });
  }

  let sent = 0;
  let skipped = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) {
      skipped++;
      continue;
    }

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    if (existingCheckin) {
      skipped++;
      continue;
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
    let consecutiveMissed = 0;
    for (let w = weekNo - 1; w >= 1 && consecutiveMissed < 3; w--) {
      if (!submittedWeeks.includes(w)) {
        consecutiveMissed++;
      } else {
        break;
      }
    }

    if (consecutiveMissed >= 2) {
      await sendEscalation(
        '2+ missed check-ins',
        `Client: ${client.name || client.id}, ${consecutiveMissed} consecutive missed`
      );
    }

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      `${weekNo}`,
      checkinUrl,
    ], true);

    sent++;
  }

  return jsonOk(res, { sent, skipped, total: activeClients.length });
};
