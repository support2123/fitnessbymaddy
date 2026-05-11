const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const now = new Date();

  // Nudge new leads that haven't replied in 2 hours
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const { data: staleNewLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

  let nudged = 0;
  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (recentOut && recentOut.length > 0) continue;

      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
      const params = isHinglish(lead.market)
        ? [lead.name || 'there', trialUrl]
        : [lead.name || 'there', trialUrl];

      await sendTemplate(lead.phone, 'nudge_trial', params, false);
      nudged++;
    }
  }

  // Mark leads as dropped after 24 hours of no reply
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const { data: expiredLeads, error: expErr } = await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('status', 'new')
    .lt('created_at', oneDayAgo)
    .select('id');

  const dropped = expiredLeads ? expiredLeads.length : 0;

  // Re-engage dropped leads (7-day rule) — one attempt only
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reengageLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', eightDaysAgo)
    .lt('last_msg_at', sevenDaysAgo);

  let reengaged = 0;
  if (reengageLeads) {
    for (const lead of reengageLeads) {
      const { data: reengageMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (reengageMsg && reengageMsg.length > 0) continue;

      const params = isHinglish(lead.market)
        ? [lead.name || 'there']
        : [lead.name || 'there'];

      await sendTemplate(lead.phone, 'reengage_7day', params, false);
      reengaged++;
    }
  }

  // Nudge active clients who haven't submitted check-ins (+24h, +48h)
  const { data: activeClients } = await supabase
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;
  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const dayOfWeek = now.getDay(); // 0=Sun

      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (checkin) continue;

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      await sendTemplate(client.phone, 'checkin_nudge', [client.name || 'there', checkinUrl], true);
      clientNudges++;
    }
  }

  return res.status(200).json({
    action: 'daily_nudge_complete',
    nudged,
    dropped,
    reengaged,
    clientNudges
  });
};
