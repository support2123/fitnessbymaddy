const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of reEngageLeads) {
      const { data: recentMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_dropped')
        .gte('sent_at', sevenDaysAgo)
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      await sendWhatsApp(lead.phone, 'reengage_dropped', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there'
        ]
      });
      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .is('program_interest', null);

    if (staleNew) {
      for (const lead of staleNew) {
        const { data: nudgeAlready } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudgeAlready && nudgeAlready.length > 0) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lte('created_at', oneDayAgo)
      .is('program_interest', null);

    return res.status(200).json({ nudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
