const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

const NUDGE_WINDOW_DAYS = 7;
const NUDGE_MIN_AGE_HOURS = 2;
const NUDGE_24H_HOURS = 24;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;
    let dropped = 0;

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', new Date(now - NUDGE_MIN_AGE_HOURS * 3600000).toISOString());

    for (const lead of (newLeads || [])) {
      const ageHours = (now - new Date(lead.created_at)) / 3600000;

      if (ageHours >= NUDGE_24H_HOURS) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
        continue;
      }

      if (ageHours >= NUDGE_MIN_AGE_HOURS) {
        const market = lead.market || detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Hey! 👋 Maddy ka $20 trial session try karo — full Zoom call + personalized plan. Interested?\nhttps://www.fitnessbymaddy.com/program-trial.html`
          : `Hey! 👋 Try Maddy's $20 trial session — full Zoom call + personalized plan. Interested?\nhttps://www.fitnessbymaddy.com/program-trial.html`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: [lead.name || 'there']
        });
        nudged++;
      }
    }

    const sevenDaysAgo = new Date(now - NUDGE_WINDOW_DAYS * 86400000).toISOString();
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const daysSinceDrop = (now - new Date(lead.last_msg_at || lead.created_at)) / 86400000;
      if (daysSinceDrop < 5 || daysSinceDrop > 7) continue;

      const market = lead.market || detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hi ${lead.name || 'there'}! Maddy ki team se — abhi bhi interested ho fitness journey mein? $20 trial se start karo 💪\nhttps://www.fitnessbymaddy.com/program-trial.html`
        : `Hi ${lead.name || 'there'}! From Maddy's team — still interested in your fitness journey? Start with a $20 trial 💪\nhttps://www.fitnessbymaddy.com/program-trial.html`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        body: msg,
        params: [lead.name || 'there']
      });
      reEngaged++;
    }

    return res.json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
