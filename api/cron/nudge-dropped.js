const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { cors } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gte('last_msg_at', fourteenDaysAgo.toISOString())
    .lte('last_msg_at', sevenDaysAgo.toISOString());

  if (!leads?.length) return res.json({ nudged: 0 });

  let nudged = 0;

  for (const lead of leads) {
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .eq('template_name', 'win_back_7d');

    if (count && count > 0) continue;

    const isIndian = lead.market === 'IN';
    const msg = isIndian
      ? `Hey ${lead.name || ''}! Maddy ka $20 trial session abhi bhi available hai. Ek session mein hi feel hoga difference.\n\nhttps://fitnessbymaddy.com/program-trial.html`
      : `Hey ${lead.name || ''}! Maddy's $20 trial session is still available. Just one session to feel the difference.\n\nhttps://fitnessbymaddy.com/program-trial.html`;

    await sendWhatsApp(lead.phone, msg, 'win_back_7d');
    nudged++;
  }

  return res.json({ nudged, total_eligible: leads.length });
};
