const { getClient } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const sb = getClient();
  const results = { nudged_2hr: 0, nudged_trial: 0, marked_dropped: 0, re_engaged: 0 };

  try {
    const now = new Date();

    // === 1. New leads with no reply after 2 hours → send trial nudge ===
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNew } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    if (staleNew) {
      for (const lead of staleNew) {
        // Check if we already nudged (look for nudge_trial in messages)
        const { data: nudges } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (!nudges || nudges.length === 0) {
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html',
          ], true);
          results.nudged_trial++;
        }
      }
    }

    // === 2. New leads with no reply after 24 hours → mark dropped ===
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await sb
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (deadLeads) {
      for (const lead of deadLeads) {
        // Only drop if the lead never replied after welcome
        const { data: replies } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at || twentyFourHoursAgo)
          .limit(1);

        if (!replies || replies.length === 0) {
          await sb.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          results.marked_dropped++;
        }
      }
    }

    // === 3. Re-engage dropped leads after 7 days (one-time) ===
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 86400000).toISOString();

    const { data: reEngageLeads } = await sb
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        // Check we haven't already sent re-engage
        const { data: reEngageMsg } = await sb
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!reEngageMsg || reEngageMsg.length === 0) {
          await sendTemplate(lead.phone, 'reengage_7day', [
            lead.name || 'there',
          ], true);
          results.re_engaged++;
        }
      }
    }

    // === 4. Nudge active clients who haven't submitted check-in (+24hr, +48hr) ===
    const { data: activeClients } = await sb
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / 86400000);
        const currentWeek = Math.floor(daysSinceStart / 7) + 1;

        // Check if check-in exists for current week
        const { data: checkin } = await sb
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        // Check how many nudges we've sent for this week
        const weekStart = new Date(startDate.getTime() + (currentWeek - 1) * 7 * 86400000);
        const { data: nudgesSent } = await sb
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_reminder')
          .gt('sent_at', weekStart.toISOString());

        const nudgeCount = nudgesSent ? nudgesSent.length : 0;
        if (nudgeCount < 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl,
          ], true);
          results.nudged_2hr++;
        }
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
