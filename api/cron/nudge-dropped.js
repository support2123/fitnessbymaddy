const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lte('last_msg_at', sevenDaysAgo.toISOString());

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of leads) {
      const { data: recentOutbound } = await db
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo.toISOString())
        .limit(1);

      if (recentOutbound && recentOutbound.length > 0) continue;

      const hinglish = isHinglish(lead.market);
      const msg = hinglish
        ? 'Hey! Maddy ka $20 trial session try kiya kya? Sirf ek session mein samajh aa jaayega ki kya expect karna hai. Link: https://fitnessbymaddy.com/program-trial.html'
        : 'Hey! Have you tried Maddy\'s $20 trial session? Just one session to see what to expect. Link: https://fitnessbymaddy.com/program-trial.html';

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        body: msg,
        params: []
      });

      nudged++;
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', fourteenDaysAgo.toISOString());

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', staleIds);
    }

    return res.status(200).json({
      message: 'Nudge cycle complete',
      nudged,
      stale_dropped: staleLeads?.length || 0
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
