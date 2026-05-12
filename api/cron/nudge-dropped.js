const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const summary = {
    checkin_nudges_24h: 0,
    checkin_nudges_48h: 0,
    checkin_escalations: 0,
    lead_nudges: 0,
    leads_dropped: 0,
    reengagements: 0,
    errors: [],
  };

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Part A — Check-in nudges for active clients
    const { data: checkinMessages, error: msgErr } = await supabase
      .from('messages')
      .select('phone, sent_at')
      .eq('template_name', 'weekly_checkin')
      .eq('direction', 'out')
      .gte('sent_at', sevenDaysAgo)
      .order('sent_at', { ascending: false });

    if (msgErr) {
      summary.errors.push(`Checkin messages query: ${msgErr.message}`);
    }

    if (checkinMessages && checkinMessages.length > 0) {
      const phoneMap = new Map();
      for (const msg of checkinMessages) {
        if (!phoneMap.has(msg.phone)) {
          phoneMap.set(msg.phone, msg);
        }
      }

      for (const [phone, msg] of phoneMap) {
        try {
          const sentAt = new Date(msg.sent_at);
          const hoursSince = (now - sentAt) / (1000 * 60 * 60);

          const { data: clientRows } = await supabase
            .from('clients')
            .select('id, name, phone, program_started_at')
            .eq('phone', phone)
            .eq('status', 'active')
            .limit(1);

          if (!clientRows || clientRows.length === 0) continue;
          const client = clientRows[0];

          const msPerWeek = 7 * 24 * 60 * 60 * 1000;
          const weekNo = Math.floor(
            (now - new Date(client.program_started_at)) / msPerWeek
          ) + 1;

          const { data: existingCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .limit(1);

          if (existingCheckin && existingCheckin.length > 0) continue;

          const prevWeek = weekNo - 1;
          if (prevWeek >= 1) {
            const { data: prevCheckin } = await supabase
              .from('checkins')
              .select('id')
              .eq('client_id', client.id)
              .eq('week_no', prevWeek)
              .limit(1);

            if (!prevCheckin || prevCheckin.length === 0) {
              await supabase.from('escalations').insert({
                phone: client.phone,
                client_id: client.id,
                reason: 'consecutive_missed_checkins',
                message_body: `Client ${client.name} missed check-ins for weeks ${prevWeek} and ${weekNo}`,
                resolved: false,
              });
              summary.checkin_escalations++;
              continue;
            }
          }

          if (hoursSince >= 48 && hoursSince < 72) {
            const { data: alreadySent } = await supabase
              .from('messages')
              .select('id')
              .eq('phone', phone)
              .eq('template_name', 'checkin_reminder_48h')
              .gte('sent_at', sevenDaysAgo)
              .limit(1);

            if (!alreadySent || alreadySent.length === 0) {
              await sendTemplate(phone, 'checkin_reminder_48h', [
                client.name || 'there',
              ]);
              summary.checkin_nudges_48h++;
            }
          } else if (hoursSince >= 24 && hoursSince < 48) {
            const { data: alreadySent } = await supabase
              .from('messages')
              .select('id')
              .eq('phone', phone)
              .eq('template_name', 'checkin_reminder_24h')
              .gte('sent_at', sevenDaysAgo)
              .limit(1);

            if (!alreadySent || alreadySent.length === 0) {
              await sendTemplate(phone, 'checkin_reminder_24h', [
                client.name || 'there',
              ]);
              summary.checkin_nudges_24h++;
            }
          }
        } catch (err) {
          summary.errors.push(`Checkin nudge: ${err.message}`);
        }
      }
    }

    // Part B — New lead nudges
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
    const twoHoursWindow = new Date(now - 2.5 * 60 * 60 * 1000);

    const { data: freshLeads, error: freshErr } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo.toISOString())
      .gte('last_msg_at', twoHoursWindow.toISOString());

    if (freshErr) {
      summary.errors.push(`Fresh leads query: ${freshErr.message}`);
    }

    if (freshLeads && freshLeads.length > 0) {
      for (const lead of freshLeads) {
        try {
          const { data: recentOut } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .gte('sent_at', twoHoursAgo.toISOString())
            .limit(1);

          if (recentOut && recentOut.length > 0) continue;

          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
          ]);
          summary.lead_nudges++;
        } catch (err) {
          summary.errors.push(`Lead nudge: ${err.message}`);
        }
      }
    }

    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads, error: staleErr } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', oneDayAgo)
      .lte('last_msg_at', oneDayAgo);

    if (staleErr) {
      summary.errors.push(`Stale leads query: ${staleErr.message}`);
    }

    if (staleLeads && staleLeads.length > 0) {
      const staleIds = staleLeads.map((l) => l.id);
      const { error: updateErr } = await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', staleIds);

      if (updateErr) {
        summary.errors.push(`Drop leads update: ${updateErr.message}`);
      } else {
        summary.leads_dropped = staleIds.length;
      }
    }

    // Part C — Dropped lead re-engagement (7-day rule)
    const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
    const windowStart = new Date(sevenDaysAgoMs - 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(sevenDaysAgoMs + 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error: droppedErr } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', windowStart)
      .lte('last_msg_at', windowEnd);

    if (droppedErr) {
      summary.errors.push(`Dropped leads query: ${droppedErr.message}`);
    }

    if (droppedLeads && droppedLeads.length > 0) {
      for (const lead of droppedLeads) {
        try {
          const { data: alreadySent } = await supabase
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'comeback_offer')
            .limit(1);

          if (alreadySent && alreadySent.length > 0) continue;

          await sendTemplate(lead.phone, 'comeback_offer', [
            lead.name || 'there',
          ]);
          summary.reengagements++;
        } catch (err) {
          summary.errors.push(`Re-engage: ${err.message}`);
        }
      }
    }

    return res.status(200).json(summary);
  } catch (err) {
    return res.status(500).json({ error: err.message, summary });
  }
};
