const supabase = require('../../lib/supabase');
const { sendTemplate, sendClientMessage } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  // Verify Vercel cron authorization
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged2hr = 0;
    let nudged24hr = 0;
    let dropped = 0;
    let reengaged = 0;

    // --- FLOW A: 2-hour nudge for new leads with no reply ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        // Check if we already sent a nudge (look for nudge_trial in messages)
        const { data: nudgesSent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .like('template_name', 'nudge%')
          .limit(1);

        if (!nudgesSent || nudgesSent.length === 0) {
          // Check if lead replied (any inbound after welcome)
          const { data: replies } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'in')
            .gt('sent_at', lead.created_at)
            .limit(1);

          if (!replies || replies.length === 0) {
            const template = isHinglish(lead.market)
              ? 'nudge_trial_hi'
              : 'nudge_trial_en';
            await sendTemplate(lead.phone, template, [
              lead.name || 'there',
              'https://www.fitnessbymaddy.com/program-trial.html',
            ], lead.name);
            nudged2hr++;
          }
        }
      }
    }

    // --- FLOW A: 24-hour drop for unresponsive leads ---
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    // --- Re-engagement: 7-day rule for dropped leads ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', thirtyDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        // Only re-engage once: check if we sent a reengage template
        const { data: reengageSent } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .like('template_name', 'reengage%')
          .limit(1);

        if (!reengageSent || reengageSent.length === 0) {
          const template = isHinglish(lead.market)
            ? 'reengage_hi'
            : 'reengage_en';
          await sendTemplate(lead.phone, template, [
            lead.name || 'there',
          ], lead.name);
          reengaged++;
        }
      }
    }

    // --- Check-in nudges: +24hr and +48hr for pending check-ins ---
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const started = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - started) / (7 * 24 * 60 * 60 * 1000));
        const dayOfWeek = now.getUTCDay(); // 0=Sun

        // Nudge on Monday (+24hr) and Tuesday (+48hr) if check-in not submitted
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const { data: thisWeekCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .limit(1);

          if (!thisWeekCheckin || thisWeekCheckin.length === 0) {
            const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendClientMessage(
              client.phone,
              'checkin_reminder',
              [client.name || 'there', String(weekNo), checkinUrl],
              client.name
            );
            checkinNudged++;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      nudged2hr,
      nudged24hr,
      dropped,
      reengaged,
      checkinNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

