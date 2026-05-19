const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ action: 'no_nudgeable_leads' });
    }

    let sent = 0;
    for (const lead of leads) {
      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';

      const result = await sendTemplate(lead.phone, templateName, {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      });

      if (result.ok) {
        await db.from('leads').update({
          last_msg_at: new Date().toISOString()
        }).eq('id', lead.id);
        sent++;
      }
    }

    return res.status(200).json({ ok: true, sent, checked: leads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
