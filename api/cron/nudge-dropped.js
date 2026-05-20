const { supabase } = require('../../lib/supabase');
const { sendTemplate, detectMarket } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const market = detectMarket(lead.phone);
      const templateName = market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial';

      try {
        await sendTemplate(lead.phone, templateName, {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there'],
        });
        nudged++;
      } catch (err) {
        console.error('Nudge failed for lead:', err.message);
      }
    }

    return res.json({ ok: true, nudged, total: leads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
