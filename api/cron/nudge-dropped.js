const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeadsToNudge } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo)
      .lt('nudge_count', 1);

    let nudgesSent = 0;

    for (const lead of (newLeadsToNudge || [])) {
      const hinglish = isHinglish(lead.market);
      const template = hinglish ? 'nudge_trial_hi' : 'nudge_trial_en';

      await sendTemplate(lead.phone, template, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/intake?phone=' + encodeURIComponent(lead.phone),
      ]);

      await db.from('leads').update({
        nudge_count: (lead.nudge_count || 0) + 1,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);

      nudgesSent++;
    }

    const { data: leadsToDropRaw } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twentyFourHoursAgo)
      .gte('nudge_count', 1);

    let dropped = 0;

    for (const lead of (leadsToDropRaw || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .lte('last_msg_at', sevenDaysAgo)
      .lt('nudge_count', 3);

    let reEngaged = 0;

    for (const lead of (reEngageLeads || [])) {
      const hinglish = isHinglish(lead.market);

      await sendTemplate(lead.phone, hinglish ? 'reengage_hi' : 'reengage_en', [
        lead.name || 'there',
      ]);

      await db.from('leads').update({
        nudge_count: (lead.nudge_count || 0) + 1,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);

      reEngaged++;
    }

    const { data: pendingCheckins } = await db
      .from('checkins')
      .select('id, client_id, week_no, created_at')
      .is('form_submitted_at', null)
      .lte('created_at', twoHoursAgo);

    let checkinNudges = 0;

    for (const checkin of (pendingCheckins || [])) {
      const { data: client } = await db
        .from('clients')
        .select('phone, name')
        .eq('id', checkin.client_id)
        .single();

      if (!client) continue;

      const hoursSinceCreated = (now - new Date(checkin.created_at)) / (1000 * 60 * 60);
      if (hoursSinceCreated >= 24 && hoursSinceCreated < 72) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${checkin.client_id}&w=${checkin.week_no}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(checkin.week_no),
          checkinUrl,
        ]);
        checkinNudges++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudgesSent,
      dropped,
      reEngaged,
      checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
