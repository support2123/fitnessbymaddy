const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { canSendToLead, isOptedOut } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal) {
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
      .eq('opted_out', false)
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;
    let skipped = 0;

    for (const lead of droppedLeads) {
      if (await isOptedOut(lead.phone)) {
        skipped++;
        continue;
      }

      if (!(await canSendToLead(lead.phone))) {
        skipped++;
        continue;
      }

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let newNudged = 0;
    if (newLeads) {
      for (const lead of newLeads) {
        if (await isOptedOut(lead.phone)) continue;
        if (!(await canSendToLead(lead.phone))) continue;

        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        newNudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twentyFourHoursAgo);

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', staleIds);
    }

    return res.status(200).json({
      status: 'ok',
      dropped_nudged: nudged,
      new_nudged: newNudged,
      auto_dropped: staleLeads?.length || 0,
      skipped
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
