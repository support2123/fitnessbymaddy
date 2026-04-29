const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { sendJson } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return sendJson(res, 200, { message: 'No active clients', sent: 0 });
  }

  let sent = 0;
  let nudged = 0;
  let escalated = 0;

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.max(1, Math.ceil(daysSinceStart / 7));

    const { data: latestCheckin } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const lastCheckinWeek = latestCheckin?.week_no || 0;

    if (lastCheckinWeek < currentWeek - 2) {
      await escalateToMaddy(
        client.phone,
        'missed_checkins',
        `${client.name || 'Client'} has missed 2+ consecutive check-ins (last: week ${lastCheckinWeek}, current: week ${currentWeek})`
      );
      escalated++;
    }

    if (lastCheckinWeek >= currentWeek) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'Champion',
      String(currentWeek),
      checkinUrl,
    ]);
    sent++;

    const { data: prevCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek - 1)
      .single();

    if (!prevCheckin && currentWeek > 1) {
      nudged++;
    }
  }

  return sendJson(res, 200, {
    processed: activeClients.length,
    checkin_forms_sent: sent,
    nudge_candidates: nudged,
    escalations: escalated,
  });
};
