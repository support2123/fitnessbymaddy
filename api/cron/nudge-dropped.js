const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { sendJson } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  const { data: newLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', new Date(now - 2 * 60 * 60 * 1000).toISOString())
    .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

  let nudgeSent = 0;
  if (newLeads) {
    for (const lead of newLeads) {
      const { data: recentOut } = await db
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1)
        .single();

      if (recentOut) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);
      nudgeSent++;
    }
  }

  const { data: staleLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

  let dropped = 0;
  if (staleLeads) {
    for (const lead of staleLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('created_at', fourteenDaysAgo.toISOString())
    .lt('created_at', sevenDaysAgo.toISOString());

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { data: wasReEngaged } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_v1')
        .limit(1)
        .single();

      if (wasReEngaged) continue;

      await sendWhatsApp(lead.phone, 'reengage_v1', [
        lead.name || 'there',
      ]);
      reEngaged++;
    }
  }

  return sendJson(res, 200, {
    nudge_sent: nudgeSent,
    dropped,
    re_engaged: reEngaged,
  });
};
