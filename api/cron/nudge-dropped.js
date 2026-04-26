const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../../lib/whatsapp');
const { logMessage } = require('../../lib/messages');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  // Find leads that went silent (new status, last msg > 2 hrs ago, < 24 hrs)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Nudge new leads (2-24 hrs since last msg)
  const { data: nudgeLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('last_msg_at', twentyFourHoursAgo);

  const results = { nudged: 0, dropped: 0, re_engaged: 0 };

  for (const lead of (nudgeLeads || [])) {
    try {
      const trialUrl = 'https://fitnessbymaddy.com/shred.html';
      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        trialUrl,
      ]);
      await logMessage(lead.phone, 'out', 'Trial nudge sent', 'nudge_trial');
      results.nudged++;
    } catch (err) {
      console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
    }
  }

  // Drop leads with no reply after 24 hrs
  const { data: dropLeads } = await db
    .from('leads')
    .select('id, phone')
    .eq('status', 'new')
    .lt('last_msg_at', twentyFourHoursAgo);

  for (const lead of (dropLeads || [])) {
    await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    results.dropped++;
  }

  // Re-engage dropped leads after 7 days (one-time)
  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .gt('created_at', sevenDaysAgo)
    .lt('last_msg_at', sevenDaysAgo);

  // Check they haven't been re-engaged already (no outbound in last 7 days)
  for (const lead of (reEngageLeads || [])) {
    const { data: recentOut } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'out')
      .gte('sent_at', sevenDaysAgo)
      .limit(1);

    if (recentOut && recentOut.length > 0) continue;

    try {
      await sendWhatsApp(lead.phone, 'reengage_7day', [
        lead.name || 'there',
      ]);
      await logMessage(lead.phone, 'out', '7-day re-engage', 'reengage_7day');
      results.re_engaged++;
    } catch (err) {
      console.error(`Re-engage failed for ${maskPhone(lead.phone)}:`, err.message);
    }
  }

  // Nudge active clients with pending check-ins (+24hrs, +48hrs)
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  for (const client of (activeClients || [])) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .maybeSingle();

    if (checkin) continue;

    // Check how long since the checkin was due (Sunday)
    const dayOfWeek = now.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 2) {
      try {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp(client.phone, 'checkin_reminder', [
          client.name || 'there',
          `${weekNo}`,
          checkinUrl,
        ]);
        await logMessage(client.phone, 'out', `Check-in reminder week ${weekNo}`, 'checkin_reminder');
      } catch (_) { /* best effort */ }
    }

    // 2 consecutive missed check-ins escalation
    if (weekNo >= 2) {
      const { data: prevCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo - 1)
        .maybeSingle();

      if (!prevCheckin) {
        const { data: existingEsc } = await db
          .from('escalations')
          .select('id')
          .eq('client_id', client.id)
          .eq('reason', '2_missed_checkins')
          .gte('created_at', sevenDaysAgo)
          .maybeSingle();

        if (!existingEsc) {
          await db.from('escalations').insert({
            phone: client.phone,
            client_id: client.id,
            reason: '2_missed_checkins',
            message_body: `Missed weeks ${weekNo - 1} and ${weekNo}`,
          });

          try {
            await sendWhatsApp(
              process.env.MADDY_PHONE || '+917082478374',
              'escalation_alert',
              [maskPhone(client.phone), `2 consecutive missed check-ins (weeks ${weekNo - 1}, ${weekNo})`]
            );
          } catch (_) { /* best effort */ }
        }
      }
    }
  }

  return res.status(200).json({ ok: true, ...results });
};
