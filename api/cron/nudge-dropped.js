const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, { error: 'GET or POST only' }, 405);
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // === Part 1: Nudge new leads who haven't replied ===
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudgeCount = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          const { data: nudges } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (!nudges || nudges.length === 0) {
            await sendWhatsApp(lead.phone, 'nudge_trial', [
              lead.name || 'there',
            ]);
            nudgeCount++;
          }
        }
      }
    }

    // === Part 2: Drop leads with no reply after 24hrs ===
    const { data: expiredLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let droppedCount = 0;
    if (expiredLeads) {
      for (const lead of expiredLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await db
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          droppedCount++;
        }
      }
    }

    // === Part 3: Re-engage dropped leads (7-day rule) ===
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reEngageCount = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { data: reEngageMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!reEngageMsg || reEngageMsg.length === 0) {
          await sendWhatsApp(lead.phone, 'reengage_7day', [
            lead.name || 'there',
          ]);
          reEngageCount++;
        }
      }
    }

    // === Part 4: Nudge clients who haven't submitted check-in ===
    const { data: pendingCheckins } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudgeCount = 0;
    const siteUrl = process.env.SITE_URL || 'https://fitnessbymaddy.com';

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: thisWeekCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (thisWeekCheckin && thisWeekCheckin.length > 0) continue;

        const dayOfWeek = now.getUTCDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `${siteUrl}/checkin?c=${client.id}&w=${currentWeek}`;
          await sendWhatsApp(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl,
          ]);
          checkinNudgeCount++;
        }
      }
    }

    return json(res, {
      action: 'nudge_complete',
      nudged: nudgeCount,
      dropped: droppedCount,
      re_engaged: reEngageCount,
      checkin_nudges: checkinNudgeCount,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
