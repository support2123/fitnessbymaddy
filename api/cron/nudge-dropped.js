const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - REENGAGEMENT_WINDOW_DAYS);

  const { data: nudgeableLeads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', cutoff.toISOString())
    .gt('last_msg_at', new Date(cutoff.getTime() - 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error('Nudge query error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  let sent = 0;

  for (const lead of nudgeableLeads || []) {
    const allowed = await canSendMessage(lead.phone, false);
    if (!allowed) continue;

    const market = detectMarket(lead.phone);
    const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';

    await sendTemplate(lead.phone, templateName, [
      lead.name || 'there'
    ]);

    sent++;
  }

  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

  const { data: noReplyLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('last_msg_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (noReplyLeads && noReplyLeads.length > 0) {
    const ids = noReplyLeads.map(l => l.id);
    await supabase.from('leads')
      .update({ status: 'dropped' })
      .in('id', ids);
  }

  return res.status(200).json({
    ok: true,
    nudged: sent,
    auto_dropped: noReplyLeads?.length || 0
  });
};
