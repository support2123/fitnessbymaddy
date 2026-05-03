const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged_leads: 0, nudged_clients: 0, errors: 0 };

  try {
    // FLOW A step 3: Nudge new leads with no reply after 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Drop leads that haven't replied in 24 hours
    await db.from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    // Nudge new leads (2-24 hours old with no qualification)
    const { data: stalledLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    if (stalledLeads) {
      for (const lead of stalledLeads) {
        try {
          // Check we haven't already nudged
          const { data: recentNudge } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('direction', 'out')
            .eq('template_name', 'nudge_trial')
            .gte('sent_at', twoHoursAgo)
            .limit(1);

          if (recentNudge && recentNudge.length > 0) continue;

          const templateName = isHinglish(lead.market) ? 'nudge_trial_hi' : 'nudge_trial';
          await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
          await logMessage(lead.phone, 'out', null, templateName);
          results.nudged_leads++;
        } catch (e) {
          results.errors++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule: one re-engagement attempt after 7 days)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lt('last_msg_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString());

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        try {
          // Only one re-engagement per dropped lead
          const { data: pastReengage } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'reengage_7day')
            .limit(1);

          if (pastReengage && pastReengage.length > 0) continue;

          const templateName = isHinglish(lead.market) ? 'reengage_7day_hi' : 'reengage_7day';
          await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
          await logMessage(lead.phone, 'out', null, templateName);
          results.nudged_leads++;
        } catch (e) {
          results.errors++;
        }
      }
    }

    // Nudge active clients with pending check-ins (+24hrs, +48hrs)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        try {
          const startDate = new Date(client.program_started_at);
          const now = new Date();
          const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
          const weekNo = Math.floor(daysSinceStart / 7) + 1;

          // Check if check-in submitted
          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();

          if (checkin) continue;

          // Check when we last sent a checkin reminder
          const { data: lastReminder } = await db
            .from('messages')
            .select('sent_at')
            .eq('phone', client.phone)
            .eq('direction', 'out')
            .like('template_name', 'checkin_%')
            .order('sent_at', { ascending: false })
            .limit(1);

          if (!lastReminder || lastReminder.length === 0) continue;

          const lastSent = new Date(lastReminder[0].sent_at);
          const hoursSinceReminder = (now - lastSent) / (1000 * 60 * 60);

          // Nudge at ~24hrs and ~48hrs
          if ((hoursSinceReminder >= 23 && hoursSinceReminder <= 26) ||
              (hoursSinceReminder >= 47 && hoursSinceReminder <= 50)) {
            const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
            await sendTemplate(client.phone, 'checkin_nudge', [
              client.name || 'there',
              String(weekNo),
              checkinUrl,
            ]);
            await logMessage(client.phone, 'out', null, 'checkin_nudge');
            results.nudged_clients++;
          }

          // 2 consecutive missed check-ins → escalate
          if (weekNo >= 3) {
            const { data: recentCheckins } = await db
              .from('checkins')
              .select('week_no')
              .eq('client_id', client.id)
              .gte('week_no', weekNo - 1)
              .limit(2);

            if (!recentCheckins || recentCheckins.length === 0) {
              await notifyMaddy(
                '2 consecutive missed check-ins',
                `Client: ${client.name} (${client.phone})\nWeeks ${weekNo - 1} and ${weekNo}`
              );
            }
          }
        } catch (e) {
          results.errors++;
        }
      }
    }

    return res.status(200).json({ success: true, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
