const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', fourteenDaysAgo);

  if (!leads || leads.length === 0) {
    return res.status(200).json({ ok: true, nudged: 0 });
  }

  let nudged = 0;

  for (const lead of leads) {
    await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
    nudged++;

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);
  }

  return res.status(200).json({ ok: true, nudged });
};
