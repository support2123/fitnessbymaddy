const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

const NUDGE_WINDOW_HOURS = 2;
const DROP_WINDOW_HOURS = 24;
const RE_ENGAGE_DAYS = 7;
const RE_ENGAGE_MAX_DAYS = 14;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, dropped: 0, re_engaged: 0 };

  try {
    const now = new Date();

    // 1. Nudge leads that haven't replied in 2 hours (status=new)
    const nudgeCutoff = new Date(now - NUDGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', nudgeCutoff)
      .gt('last_msg_at', new Date(now - DROP_WINDOW_HOURS * 60 * 60 * 1000).toISOString());

    for (const lead of staleLeads || []) {
      // Check if we already nudged (check messages table)
      const { data: nudgesSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (nudgesSent && nudgesSent.length > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/program-trial.html'
        ]
      });
      results.nudged++;
    }

    // 2. Drop leads with no reply after 24 hours
    const dropCutoff = new Date(now - DROP_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data: dropLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', dropCutoff);

    if (dropLeads && dropLeads.length > 0) {
      const ids = dropLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
      results.dropped = ids.length;
    }

    // 3. Re-engage dropped leads (7-day rule, max 14 days old)
    const reEngageStart = new Date(now - RE_ENGAGE_MAX_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const reEngageEnd = new Date(now - RE_ENGAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', reEngageStart)
      .lt('last_msg_at', reEngageEnd);

    for (const lead of droppedLeads || []) {
      // Don't re-engage if we already sent a re-engagement message
      const { data: reEngageSent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 're_engage_dropped')
        .limit(1);

      if (reEngageSent && reEngageSent.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      await sendTemplate(lead.phone, 're_engage_dropped', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/program-trial.html'
        ]
      });
      results.re_engaged++;
    }

    // 4. Nudge clients who haven't submitted check-ins (+24hrs, +48hrs)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const started = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - started) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;
      const dayOfWeek = now.getDay(); // 0=Sun

      // Only nudge on Monday (day after Sunday check-in) and Tuesday
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: weekCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (weekCheckin && weekCheckin.length > 0) continue;

      const nudgeTemplate = dayOfWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, nudgeTemplate, {
        name: client.name || 'there',
        templateParams: [client.name || 'there', checkinUrl],
        is_client: true
      });
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
