const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');

const REENGAGEMENT_WINDOW_DAYS = 7;
const COOLDOWN_DAYS = 30;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - REENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('created_at', thirtyDaysAgo);

    let nudged = 0;

    if (newLeads && newLeads.length > 0) {
      for (const lead of newLeads) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (recentMsg) {
          const lastSent = new Date(recentMsg.sent_at).getTime();
          const hoursSince = (Date.now() - lastSent) / (1000 * 60 * 60);
          if (hoursSince < 48) continue;
        }

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const msgBody = hinglish
          ? [`Hey! 👋 Maddy ki team se. Aapne pehle fitness ke baare mein poochha tha.\n\nHumare $20 Zoom trial se shuru karo — bilkul risk-free!\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nKoi sawaal ho toh poocho 😊`]
          : [`Hey! 👋 From Maddy's team. You reached out about fitness earlier.\n\nStart with our $20 Zoom trial — completely risk-free!\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nFeel free to ask any questions 😊`];

        const result = await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msgBody
        });

        if (result.sent) nudged++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo)
      .lt('created_at', oneDayAgo);

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      dropped: staleLeads?.length || 0
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
