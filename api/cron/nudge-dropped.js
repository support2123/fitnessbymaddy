const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!leads || leads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of leads) {
      const { data: recentOutbound } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentOutbound && recentOutbound.length > 0) continue;

      const hinglish = isHinglish(detectMarket(lead.phone));

      const msg = hinglish
        ? `Hey${lead.name ? ' ' + lead.name : ''}! 👋 Maddy ki team se.\n\nAbhi bhi fitness goals pe kaam karna hai? Humara $20 trial session try karo — koi commitment nahi.\n\n🔗 https://fitnessbymaddy.com/program-trial.html\n\nReply "STOP" if you don't want to hear from us.`
        : `Hey${lead.name ? ' ' + lead.name : ''}! 👋 From Maddy's team.\n\nStill working on those fitness goals? Try our $20 trial session — zero commitment.\n\n🔗 https://fitnessbymaddy.com/program-trial.html\n\nReply "STOP" if you'd prefer not to hear from us.`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        body: msg
      });

      if (!result.rateLimited) sent++;
    }

    return res.status(200).json({ success: true, sent, total: leads.length });

  } catch (err) {
    console.error('Nudge dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
