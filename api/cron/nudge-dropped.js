const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { detectMarket, getNudgeMessage } = require('../../lib/market');

const BASE_URL = process.env.BASE_URL || 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const db = getSupabase();

    // FLOW A — 2-hour nudge for new leads with no reply
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudgedNew = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        // Check if we already nudged
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        if (await canSendMessage(lead.phone, false)) {
          const market = lead.market || detectMarket(lead.phone);
          await sendTemplate(lead.phone, 'nudge_trial', [
            getNudgeMessage(market),
            `${BASE_URL}/shred.html`
          ]);
          nudgedNew++;
        }
      }
    }

    // FLOW A — 24-hour drop for unresponsive leads
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: dropLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    if (dropLeads) {
      for (const lead of dropLeads) {
        // Check if they ever replied
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!replies || replies.length === 0) {
          await db.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Re-engagement: leads dropped exactly 7 days ago
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const { data: reengageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', eightDaysAgo.toISOString())
      .lt('last_msg_at', sevenDaysAgo.toISOString());

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        // Only re-engage once
        const { data: reengage_msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengage_msgs && reengage_msgs.length > 0) continue;

        if (await canSendMessage(lead.phone, false)) {
          const market = lead.market || detectMarket(lead.phone);
          const isHinglish = market === 'IN';
          const msg = isHinglish
            ? `Hey! Abhi bhi fitness goals pe kaam karna hai? Maddy ke programs mein limited spots hain. Check karo:`
            : `Hey! Still working on those fitness goals? Limited spots in Maddy's programs. Check it out:`;

          await sendTemplate(lead.phone, 'reengage_7day', [msg, BASE_URL]);
          reengaged++;
        }
      }
    }

    // Check-in nudges: +24hr and +48hr reminders
    const oneDayAgoDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgoDate = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        // Check when we last reminded
        const { data: lastReminder } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_reminder')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const shouldNudge = !lastReminder ||
          new Date(lastReminder.sent_at) < oneDayAgoDate;

        if (shouldNudge) {
          const formUrl = `${BASE_URL}/checkin?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            `Week ${weekNo} check-in pending!`,
            formUrl
          ]);
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      nudgedNew,
      dropped,
      reengaged,
      checkinNudges
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
