const { supabase } = require('../../lib/supabase');
const { sendTemplate, checkRateLimit } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find leads that went quiet (new status, no reply in 2+ hours, < 24 hours old)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads (2-24 hour window)
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of staleLeads || []) {
      const limited = await checkRateLimit(lead.phone);
      if (!limited) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake.html'
        ]);
        nudged++;
      }
    }

    // Drop leads older than 24 hours with no qualification
    const { data: oldLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (oldLeads && oldLeads.length > 0) {
      const ids = oldLeads.map(l => l.id);
      await supabase.from('leads').update({ status: 'dropped' }).in('id', ids);
      dropped = ids.length;
    }

    // Re-engage dropped leads (7-day rule: only once, 7 days after drop)
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of reEngageLeads || []) {
      // Check if we already sent a re-engagement message
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (!msgs || msgs.length === 0) {
        const limited = await checkRateLimit(lead.phone);
        if (!limited) {
          await sendTemplate(lead.phone, 'reengage_7day', [
            lead.name || 'there'
          ]);
          reEngaged++;
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, dropped, reEngaged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
