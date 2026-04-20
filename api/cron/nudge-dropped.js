const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const { data: droppedLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo)
    .lte('last_msg_at', sevenDaysAgo);

  if (!droppedLeads || droppedLeads.length === 0) {
    return res.status(200).json({ status: 'no_leads_to_nudge' });
  }

  const { data: alreadyNudged } = await supabase
    .from('messages')
    .select('phone')
    .eq('template_name', 'win_back_v1')
    .gte('sent_at', sevenDaysAgo);

  const nudgedPhones = new Set((alreadyNudged || []).map(m => m.phone));

  let sent = 0;
  for (const lead of droppedLeads) {
    if (nudgedPhones.has(lead.phone)) continue;

    const market = lead.market || detectMarket(lead.phone);
    const template = market === 'IN' ? 'win_back_v1' : 'win_back_v1_en';

    await sendTemplate(lead.phone, template, [lead.name || 'there']);
    sent++;
  }

  return res.status(200).json({ status: 'done', sent, total: droppedLeads.length });
};

function isVercelCron(req) {
  return req.headers['x-vercel-cron'] === '1';
}
