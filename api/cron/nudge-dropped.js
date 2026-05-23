const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();
    const results = { nudged_2hr: 0, nudged_24hr: 0, re_engaged: 0, errors: 0 };

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // NUDGE 1: New leads with no reply after 2 hours
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    for (const lead of (newLeads || [])) {
      try {
        // Check if we already sent a nudge (check messages for nudge template)
        const { data: nudges } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudges && nudges.length > 0) continue;

        const templateName = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial';
        await sendTemplate(lead.phone, templateName, []);
        results.nudged_2hr++;
      } catch (err) {
        results.errors++;
      }
    }

    // NUDGE 2: Leads still "new" after 24 hours — mark as dropped
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    }

    // RE-ENGAGE: Dropped leads from 7+ days ago (one-time re-engagement)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());

    for (const lead of (droppedLeads || [])) {
      try {
        // Check if we already re-engaged
        const { data: reEngaged } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reEngaged && reEngaged.length > 0) continue;

        const templateName = isHinglish(lead.market) ? 'reengage_7day_hi' : 'reengage_7day';
        await sendTemplate(lead.phone, templateName, []);
        results.re_engaged++;
      } catch (err) {
        results.errors++;
      }
    }

    // CHECKIN NUDGES: Clients who haven't submitted their check-in
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      try {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

        if (client.program_ends_at && now > new Date(client.program_ends_at)) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        // Check how many nudges we've sent this week for the check-in
        const weekStart = new Date(startDate.getTime() + (weekNo - 1) * 7 * 24 * 60 * 60 * 1000);
        const { data: nudgesSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .like('template_name', 'checkin_nudge%')
          .gte('sent_at', weekStart.toISOString());

        const nudgeCount = nudgesSent?.length || 0;
        if (nudgeCount >= 2) continue;

        let market = 'GLOBAL';
        if (client.lead_id) {
          const { data: lead } = await db
            .from('leads')
            .select('market')
            .eq('id', client.lead_id)
            .single();
          market = lead?.market || 'GLOBAL';
        }

        const templateName = isHinglish(market) ? 'checkin_nudge_hi' : 'checkin_nudge';
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, templateName, [client.name || 'there', checkinUrl]);
      } catch (err) {
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
