const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('../_lib/whatsapp');
const { canSendMessage, logMessage } = require('../_lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', sent: 0 });
    }

    let sent = 0;

    for (const lead of droppedLeads) {
      try {
        if (!(await canSendMessage(lead.phone))) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', 'Re-engagement nudge', 'nudge_trial');
        sent++;
      } catch (sendErr) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, sendErr.message);
      }
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gte('created_at', sevenDaysAgo);

    if (stalledLeads) {
      for (const lead of stalledLeads) {
        try {
          if (!(await canSendMessage(lead.phone))) continue;

          const { count } = await db
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('phone', lead.phone)
            .eq('direction', 'out');

          if (count >= 3) {
            await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
            continue;
          }

          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
          await logMessage(lead.phone, 'out', 'Stalled lead nudge', 'nudge_trial');
          sent++;
        } catch (sendErr) {
          console.error(`Stalled nudge failed for ${maskPhone(lead.phone)}:`, sendErr.message);
        }
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: abandonedLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', oneDayAgo)
      .lt('created_at', oneDayAgo);

    if (abandonedLeads && abandonedLeads.length > 0) {
      const ids = abandonedLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    console.log(`Nudge cron: ${sent} sent`);
    return res.status(200).json({ sent });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
