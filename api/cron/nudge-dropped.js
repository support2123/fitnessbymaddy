const { getSupabase } = require('../_lib/supabase');
const { canSendMessage, sendTemplate, logMessage } = require('../_lib/whatsapp');
const { isHinglishMarket } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads } = await db
      .from('leads')
      .select('id, phone, name, market, status, last_msg_at, created_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const allowed = await canSendMessage(lead.phone, false);
        if (!allowed) continue;

        const templateName = isHinglishMarket(lead.market)
          ? 'nudge_trial_hi'
          : 'nudge_trial';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        await logMessage(lead.phone, 'out', 'Trial nudge', templateName);
        nudged++;
      }
    }

    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const allowed = await canSendMessage(lead.phone, false);
        if (!allowed) continue;

        const { count } = await db
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 're_engage');

        if ((count || 0) > 0) continue;

        await sendTemplate(lead.phone, 're_engage', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', 'Re-engagement', 're_engage');
        reEngaged++;
      }
    }

    const { data: missedCheckins } = await db
      .from('clients')
      .select(`
        id, phone, name,
        checkins (week_no, form_submitted_at)
      `)
      .eq('status', 'active');

    let checkinNudges = 0;
    if (missedCheckins) {
      for (const client of missedCheckins) {
        const startDate = new Date(client.program_started_at || now);
        const daysSince = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSince / 7);

        const submittedWeeks = (client.checkins || []).map(c => c.week_no);
        const missedCount = [];
        for (let w = Math.max(1, currentWeek - 2); w <= currentWeek; w++) {
          if (!submittedWeeks.includes(w)) missedCount.push(w);
        }

        if (missedCount.length >= 2) {
          await sendTemplate(
            process.env.MADDY_PHONE || '+917082478374',
            'escalation_alert',
            [client.name, `2+ missed check-ins (weeks ${missedCount.join(',')})`]
          );
        } else if (missedCount.length === 1) {
          const allowed = await canSendMessage(client.phone, true);
          if (allowed) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${missedCount[0]}`;
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              String(missedCount[0]),
              checkinUrl,
            ]);
            await logMessage(client.phone, 'out', `Checkin nudge week ${missedCount[0]}`, 'checkin_reminder');
            checkinNudges++;
          }
        }
      }
    }

    return res.json({ status: 'ok', nudged, dropped, reEngaged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
