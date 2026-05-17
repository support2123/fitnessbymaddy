const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { logMessage, canSendMessage } = require('../../lib/rate-limit');
const { getNudge } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();

    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        await sendTemplate(lead.phone, 'nudge_trial', []);
        await logMessage(lead.phone, 'out', getNudge(lead.market || 'GLOBAL'), 'nudge_trial');
        nudged++;
      }
    }

    const { data: dropLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (dropLeads) {
      for (const lead of dropLeads) {
        await db
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', sevenDaysAgo)
      .is('program_interest', null);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const allowed = await canSendMessage(lead.phone);
        if (!allowed) continue;

        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact' })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if (count && count > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', []);
        await logMessage(lead.phone, 'out', 'Re-engagement attempt', 'reengage_7day');
        reEngaged++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: lastCheckin } = await db
          .from('checkins')
          .select('form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1)
          .single();

        if (lastCheckin) continue;

        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('template_name', 'weekly_checkin')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (!lastMsg) continue;

        const hoursSinceMsg = (now - new Date(lastMsg.sent_at)) / (1000 * 60 * 60);

        if (hoursSinceMsg >= 24 && hoursSinceMsg < 48) {
          await sendTemplate(client.phone, 'checkin_nudge_24h', [
            client.name || 'there',
            String(currentWeek),
          ]);
          await logMessage(client.phone, 'out', 'Check-in nudge 24h', 'checkin_nudge_24h');
          checkinNudged++;
        } else if (hoursSinceMsg >= 48 && hoursSinceMsg < 72) {
          await sendTemplate(client.phone, 'checkin_nudge_48h', [
            client.name || 'there',
            String(currentWeek),
          ]);
          await logMessage(client.phone, 'out', 'Check-in nudge 48h', 'checkin_nudge_48h');
          checkinNudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      re_engaged: reEngaged,
      checkin_nudged: checkinNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
