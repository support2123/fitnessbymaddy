const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { cors } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: newLeadsNoReply } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twoDaysAgo)
    .gte('created_at', sevenDaysAgo);

  const results = [];

  if (newLeadsNoReply) {
    for (const lead of newLeadsNoReply) {
      const { data: msgs } = await db
        .from('messages')
        .select('template_name')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there'
      ]);

      results.push({ phone: lead.phone, action: 'nudge_sent' });
    }
  }

  const tooOld = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: staleLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('last_msg_at', tooOld)
    .lt('created_at', tooOld);

  if (staleLeads) {
    const staleIds = staleLeads.map(l => l.id);
    if (staleIds.length > 0) {
      await db.from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
    }
  }

  return res.status(200).json({ nudged: results.length, results });
};
