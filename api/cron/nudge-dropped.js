const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { jsonResponse } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse(res, { error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();
  const now = new Date();

  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data: pendingNudges } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoDaysAgo);

  let nudged = 0;

  for (const lead of pendingNudges || []) {
    const hoursSinceMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

    if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/program-trial.html',
      ]);
      nudged++;
    } else if (hoursSinceMsg >= 24) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    }
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  let reEngaged = 0;

  for (const lead of reEngageLeads || []) {
    const { data: msgCount } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'reengage_7day');

    if (!msgCount || msgCount.length === 0) {
      const market = lead.market;
      const params = market === 'IN'
        ? [lead.name || 'there', 'Abhi bhi interested ho? Maddy ka $20 trial try karo - koi commitment nahi!']
        : [lead.name || 'there', 'Still interested? Try Maddy\'s $20 trial session - no commitment!'];

      await sendTemplate(lead.phone, 'reengage_7day', params);
      reEngaged++;
    }
  }

  return jsonResponse(res, { ok: true, nudged, reEngaged });
};
