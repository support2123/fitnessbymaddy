const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { json } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // --- Nudge new leads who haven't replied (2hr and 24hr) ---
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  for (const lead of staleNewLeads || []) {
    const { data: msgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (!msgs || msgs.length === 0) {
      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);
    }
  }

  // --- Drop leads with no reply after 24hrs ---
  const { data: expiredLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  for (const lead of expiredLeads || []) {
    const { data: msgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (!msgs || msgs.length === 0) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    }
  }

  // --- Nudge clients with missing check-ins (24hr and 48hr) ---
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let missedCheckinsCount = 0;
  for (const client of activeClients || []) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .limit(1);

    if (checkin && checkin.length > 0) continue;

    const dayOfWeek = now.getDay();
    if (dayOfWeek === 1 || dayOfWeek === 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
      await sendWhatsApp(client.phone, 'checkin_reminder', [
        client.name || 'there',
        checkinUrl,
      ]);
    }

    // 2 consecutive missed weeks → escalate
    const { data: prevCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek - 1)
      .limit(1);

    if ((!prevCheckin || prevCheckin.length === 0) && currentWeek > 1) {
      missedCheckinsCount++;
      await notifyMaddy(
        '2 missed check-ins',
        `${maskPhone(client.phone)} (${client.name}) — weeks ${currentWeek - 1} & ${currentWeek}`
      );
    }
  }

  return json(res, 200, {
    nudged_leads: (staleNewLeads || []).length,
    dropped_leads: (expiredLeads || []).length,
    missed_checkins_escalated: missedCheckinsCount,
  });
};
