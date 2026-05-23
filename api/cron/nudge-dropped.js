const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  const db = getSupabase();
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const { data: pendingLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo.toISOString());

  const nudged = [];

  if (pendingLeads) {
    for (const lead of pendingLeads) {
      const hoursSinceMsg = (now - new Date(lead.last_msg_at)) / (1000 * 60 * 60);

      if (hoursSinceMsg >= 2 && hoursSinceMsg < 24) {
        const { data: nudgesSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (!nudgesSent || nudgesSent.length === 0) {
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            params: [lead.name || 'there'],
          });
          nudged.push(lead.id);
        }
      }

      if (hoursSinceMsg >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('last_msg_at', eightDaysAgo.toISOString())
    .lt('last_msg_at', sevenDaysAgo.toISOString());

  const reEngaged = [];

  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { data: prevReEngage } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (!prevReEngage || prevReEngage.length === 0) {
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          params: [lead.name || 'there'],
        });
        reEngaged.push(lead.id);
      }
    }
  }

  return res.status(200).json({
    ok: true,
    nudged: nudged.length,
    dropped_today: pendingLeads?.filter(l => {
      const hrs = (now - new Date(l.last_msg_at)) / (1000 * 60 * 60);
      return hrs >= 24;
    }).length || 0,
    re_engaged: reEngaged.length,
  });
};
