const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: stalledLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoDaysAgo)
    .gt('last_msg_at', sevenDaysAgo);

  if (!stalledLeads || stalledLeads.length === 0) {
    return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
  }

  let nudged = 0;

  for (const lead of stalledLeads) {
    const { data: msgCount } = await db
      .from('messages')
      .select('id', { count: 'exact' })
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'nudge_trial');

    if (msgCount && msgCount.length >= 2) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      continue;
    }

    await sendWhatsApp(lead.phone, 'nudge_trial', {
      name: lead.name || 'there',
      templateParams: ['https://www.fitnessbymaddy.com/program-trial.html']
    });

    nudged++;
  }

  return res.status(200).json({ nudged, checked: stalledLeads.length });
};
