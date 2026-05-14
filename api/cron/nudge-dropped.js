const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !process.env.VERCEL_URL) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: nudgeLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoDaysAgo.toISOString())
      .gt('created_at', sevenDaysAgo.toISOString());

    if (!nudgeLeads || nudgeLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', processed: 0 });
    }

    let nudged = 0;
    let dropped = 0;

    for (const lead of nudgeLeads) {
      const createdAt = new Date(lead.created_at);
      const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24 * 5) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        continue;
      }

      const { data: recentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .order('sent_at', { ascending: false })
        .limit(1);

      if (recentMsg && recentMsg.length > 0) {
        const lastOut = new Date(recentMsg[0].sent_at);
        const hoursSinceLastMsg = (now - lastOut) / (1000 * 60 * 60);
        if (hoursSinceLastMsg < 2) continue;
      }

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const msg = hinglish
        ? `Hey ${lead.name || 'there'}! Maddy ka $20 trial class try karo - ek session mein hi fark dikhega. Book karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
        : `Hey ${lead.name || 'there'}! Try Maddy's $20 trial session - see real results in just one class. Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        body: msg
      });

      nudged++;
    }

    return res.status(200).json({
      message: 'Nudge cycle complete',
      processed: nudgeLeads.length,
      nudged,
      dropped
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
