const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'POST' || req.headers['x-internal-key'] !== process.env.SUPABASE_SERVICE_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsToNudge?.length) {
      for (const lead of newLeadsToNudge) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count > 0) continue;

        const market = lead.market;
        const msg = market === 'IN'
          ? `Hey ${lead.name || 'there'}! 👋\n\nAbhi decide nahi kar pa rahe? No worries — ek $20 Zoom trial se start karo.\n\n1 live session with Maddy's team + personalized feedback.\n\n🔗 https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nKoi question? Yahi poocho!`
          : `Hey ${lead.name || 'there'}! 👋\n\nStill deciding? No worries — start with a $20 Zoom trial.\n\n1 live session + personalized feedback.\n\n🔗 https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial\n\nAny questions? Ask here!`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: { name: lead.name, templateParams: [lead.name || 'there'] }
        });

        nudged++;
      }
    }

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    if (staleLeads?.length) {
      const staleIds = staleLeads.map(l => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);
      dropped = staleIds.length;
    }

    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', sevenDaysAgo)
      .lt('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (reengageLeads?.length) {
      for (const lead of reengageLeads.slice(0, 10)) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_offer');

        if (count > 0) continue;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_offer',
          body: `Hey ${lead.name || 'there'}! Still thinking about fitness goals? 🤔\n\nWe have a limited spot open. Reply "YES" if you'd like to chat about what program fits you best.`,
          params: { name: lead.name }
        });

        reengaged++;
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reengaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
