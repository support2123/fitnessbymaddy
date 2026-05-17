const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
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
      .eq('opted_out', false)
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (!reEngageLeads || reEngageLeads.length === 0) {
      return res.status(200).json({ nudged: 0 });
    }

    let nudged = 0;

    for (const lead of reEngageLeads) {
      const { count } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_offer')
        .limit(1);

      if (count > 0) continue;

      const isHinglish = lead.market === 'IN';

      await sendWhatsApp(lead.phone, 'reengage_offer', [
        lead.name || 'there',
        isHinglish
          ? 'Maddy ka $20 ka trial abhi bhi available hai — ek Zoom session try karo, phir decide karo!'
          : 'Maddy\'s $20 trial is still available — try a Zoom session, then decide!',
        'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
      ]);

      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNew } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twentyFourHoursAgo);

    if (staleNew) {
      for (const lead of staleNew) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    const { data: needsNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    if (needsNudge) {
      for (const lead of needsNudge) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial');

        if (count > 0) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
        ]);
      }
    }

    return res.status(200).json({ nudged, staleDropped: staleNew?.length || 0 });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
