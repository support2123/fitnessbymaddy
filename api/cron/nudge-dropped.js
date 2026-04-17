const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    const nudged = [];

    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const hinglish = isHinglish(lead.market || 'IN');
        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! Humara $20 Zoom trial try karo — risk-free hai, aur Maddy personally guide karegi. Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
          : `Hey ${lead.name || 'there'}! Try our $20 Zoom trial — risk-free, and Maddy guides you personally. Link: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

        const result = await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there'],
          body: msg
        });

        if (!result.rateLimited) {
          nudged.push(lead.id);
        }
      }
    }

    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (expiredLeads) {
      const expiredIds = expiredLeads.map(l => l.id);
      if (expiredIds.length > 0) {
        await supabase.from('leads').update({ status: 'dropped' }).in('id', expiredIds);
      }
    }

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo);

    const reEngaged = [];
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: recentOut } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_dropped')
          .limit(1);

        if (recentOut && recentOut.length > 0) continue;

        const hinglish = isHinglish(lead.market || 'IN');
        const msg = hinglish
          ? `${lead.name || 'Hey'}! Maddy ke paas limited spots bache hain is month. Agar serious ho goals ke baare mein, toh abhi $20 trial book karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`
          : `${lead.name || 'Hey'}! Maddy has limited spots left this month. If you're serious about your goals, book a $20 trial now: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_dropped',
          params: [lead.name || 'there'],
          body: msg
        });

        reEngaged.push(lead.id);
      }
    }

    return res.status(200).json({
      ok: true,
      nudged: nudged.length,
      expired: expiredLeads?.length || 0,
      reEngaged: reEngaged.length
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Nudge cron failed' });
  }
};
