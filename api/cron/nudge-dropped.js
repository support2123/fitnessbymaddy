const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const internalKey = req.headers['x-internal-key'];
  if (!isVercelCron && internalKey !== process.env.SUPABASE_SERVICE_KEY) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const db = getSupabase();

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: nudgeLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo.toISOString())
    .gte('created_at', twentyFourHoursAgo.toISOString());

  let nudged = 0;
  let dropped = 0;

  if (nudgeLeads) {
    for (const lead of nudgeLeads) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        trialUrl,
      ]);
      nudged++;
    }
  }

  const { data: expiredLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twentyFourHoursAgo.toISOString());

  if (expiredLeads) {
    for (const lead of expiredLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo.toISOString())
    .lte('last_msg_at', sevenDaysAgo.toISOString());

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { data: reEngageMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .limit(1);

      if (reEngageMsgs && reEngageMsgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'reengage_dropped', [
        lead.name || 'there',
      ]);
      reEngaged++;
    }
  }

  return json(res, 200, { success: true, nudged, dropped, reEngaged });
};
