const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await supabase
      .from('leads')
      .select('id, phone, name, created_at')
      .eq('status', 'new')
      .lte('created_at', twoDaysAgo)
      .gte('created_at', sevenDaysAgo);

    if (!newLeads || newLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0, dropped: 0 });
    }

    let nudged = 0;
    let dropped = 0;

    for (const lead of newLeads) {
      const leadAge = now - new Date(lead.created_at);
      const hoursOld = leadAge / (1000 * 60 * 60);

      if (hoursOld >= 24 && hoursOld < 48) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
        continue;
      }

      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentMsg && recentMsg.length > 0) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    const { data: qualifiedStale } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'qualified')
      .lte('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (qualifiedStale) {
      for (const lead of qualifiedStale) {
        const { data: recentMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (recentMsg && recentMsg.length > 0) continue;

        await sendTemplate(lead.phone, 'nudge_qualified', [lead.name || 'there']);
        reengaged++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron complete',
      nudged,
      dropped,
      reengaged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
