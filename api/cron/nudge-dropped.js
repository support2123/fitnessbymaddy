const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getClient();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeadsNudge?.length) {
      for (const lead of newLeadsNudge) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count === 0) {
          await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there'], false);
          nudged++;
        }
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('created_at', twentyFourHoursAgo);

    if (staleLeads?.length) {
      for (const lead of staleLeads) {
        const { data: recentIn } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!recentIn?.length) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    const { data: droppedLeadsReengage } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gt('created_at', sevenDaysAgo)
      .lt('created_at', twentyFourHoursAgo);

    let reengaged = 0;

    if (droppedLeadsReengage?.length) {
      for (const lead of droppedLeadsReengage) {
        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (count === 0) {
          const hinglish = isHinglish(lead.market);
          await sendTemplate(
            lead.phone,
            'reengage_7day',
            [lead.name || 'there'],
            false
          );
          reengaged++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      results: { nudged, dropped, reengaged },
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
