const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // --- Nudge new leads who haven't replied (2hr + 24hr rules from Flow A) ---
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // New leads with no reply after 2 hours — send trial nudge
  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  let nudged = 0;
  for (const lead of (staleNewLeads || [])) {
    const { data: msgs } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (msgs && msgs.length > 0) continue;

    await sendTemplate(lead.phone, 'nudge_trial', [
      lead.name || 'there',
      'https://fitnessbymaddy.com/program-trial.html'
    ]);
    nudged++;
  }

  // New leads with no reply after 24 hours — mark dropped
  const { data: deadLeads } = await db
    .from('leads')
    .select('id, phone')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo)
    .gt('created_at', sevenDaysAgo);

  let dropped = 0;
  for (const lead of (deadLeads || [])) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (replies && replies.length > 0) continue;

    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    dropped++;
  }

  // --- Nudge active clients with missed check-ins (24hr + 48hr) ---
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let checkinNudges = 0;
  let escalations = 0;

  for (const client of (activeClients || [])) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (checkin) continue;

    const weekStart = new Date(startDate.getTime() + (currentWeek - 1) * 7 * 24 * 60 * 60 * 1000);
    const daysSinceWeekStart = Math.floor((now - weekStart) / (1000 * 60 * 60 * 24));

    if (daysSinceWeekStart >= 1 && daysSinceWeekStart < 2) {
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      await sendTemplate(client.phone, 'checkin_reminder', [
        client.name || 'there',
        checkinUrl
      ]);
      checkinNudges++;
    }

    // 2 consecutive missed check-ins → escalate
    if (currentWeek >= 2) {
      const { data: prevCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek - 1)
        .single();

      if (!prevCheckin && daysSinceWeekStart >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)} (${client.program})\nWeeks ${currentWeek - 1} & ${currentWeek} missing.`
        );
        escalations++;
      }
    }
  }

  console.log(`[Cron/nudge] Nudged: ${nudged}, Dropped: ${dropped}, Checkin nudges: ${checkinNudges}, Escalations: ${escalations}`);

  return res.status(200).json({
    nudged,
    dropped,
    checkin_nudges: checkinNudges,
    escalations
  });
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
