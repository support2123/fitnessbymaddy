const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: stalledLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo);

    let nudged = 0;

    for (const lead of (stalledLeads || [])) {
      const createdAt = new Date(lead.created_at);
      const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        continue;
      }

      if (hoursSinceCreated >= 2 && hoursSinceCreated < 24) {
        const { data: recentNudge } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .single();

        if (!recentNudge) {
          await sendWhatsApp({
            phone: lead.phone,
            templateName: 'nudge_trial',
            bodyValues: [lead.name || 'there'],
          });
          nudged++;
        }
      }
    }

    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString();
    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .gte('created_at', thirtyDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reEngaged = 0;

    for (const lead of (reEngageLeads || [])) {
      const { data: alreadySent } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_v1')
        .single();

      if (!alreadySent) {
        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_v1',
          bodyValues: [lead.name || 'there'],
        });
        reEngaged++;
      }
    }

    return res.json({ nudged, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
