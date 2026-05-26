const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Re-engage dropped leads from last 7 days (but not older)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('created_at', sevenDaysAgo)
    .lte('last_msg_at', oneDayAgo);

  let reEngaged = 0;

  for (const lead of (droppedLeads || [])) {
    const allowed = await canSendToLead(lead.phone);
    if (!allowed) continue;

    const { count } = await db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .ilike('template_name', '%nudge%');

    if (count >= 2) continue;

    await sendTemplate(lead.phone, 'nudge_trial', {
      name: lead.name || 'there',
      templateParams: [lead.name || 'there']
    });
    reEngaged++;
  }

  // Nudge active clients who haven't submitted check-ins
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;

  for (const client of (activeClients || [])) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const expectedWeek = Math.ceil(daysSinceStart / 7);

    if (expectedWeek < 1) continue;

    const { data: latestCheckin } = await db
      .from('checkins')
      .select('week_no, form_submitted_at')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const lastWeek = latestCheckin ? latestCheckin.week_no : 0;
    if (lastWeek >= expectedWeek) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${expectedWeek}`;
    const market = client.market || 'IN';

    await sendTemplate(client.phone, 'checkin_reminder', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(expectedWeek), checkinUrl]
    });
    clientNudges++;
  }

  return res.status(200).json({
    ok: true,
    dropped_reengaged: reEngaged,
    client_nudges: clientNudges
  });
};
