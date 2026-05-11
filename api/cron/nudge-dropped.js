const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gte('created_at', eightDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.json({ ok: true, nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengagement')
        .limit(1);

      if (count && count > 0) continue;

      const hinglish = isHinglish(lead.market || detectMarket(lead.phone));
      const trialUrl = 'https://fitnessbymaddy.com/shred.html';

      await sendWhatsApp({
        phone: lead.phone,
        templateName: hinglish ? 'reengagement_hi' : 'reengagement',
        params: [lead.name || 'there', trialUrl],
      });

      nudged++;
    }

    return res.json({ ok: true, nudged, eligible: leads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
