const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { getCheckinUrl } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const now = new Date();

    // PART 1: Nudge leads who haven't replied (2hr and 24hr rules)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let leadNudges = 0;
    for (const lead of staleLeads || []) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gte('sent_at', twoHoursAgo)
        .limit(1);

      if (msgs && msgs.length > 0) continue;

      await sendWhatsApp(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);
      leadNudges++;
    }

    // Drop leads older than 24hrs with no reply
    const { data: expiredLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      const ids = expiredLeads.map(l => l.id);
      await db.from('leads').update({ status: 'dropped' }).in('id', ids);
    }

    // PART 2: Nudge clients who missed check-ins (+24hr, +48hr)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;
    let escalations = 0;

    for (const client of activeClients || []) {
      const weekNo = computeCurrentWeek(client.program_started_at);

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const daysSinceSunday = now.getDay();
      if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
        const checkinUrl = getCheckinUrl(client.id, weekNo);
        await sendWhatsApp(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ]);
        clientNudges++;
      }

      // Check for 2 consecutive missed check-ins → escalate
      if (weekNo >= 3) {
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .lte('week_no', weekNo - 1);

        if (!recentCheckins || recentCheckins.length === 0) {
          await sendWhatsApp(
            process.env.MADDY_PHONE || '+917082478374',
            'escalation_alert',
            ['missed_checkins', client.name || client.phone, `2 consecutive missed (week ${weekNo - 2} & ${weekNo - 1})`]
          );
          escalations++;
        }
      }
    }

    // PART 3: Re-engage dropped leads (7-day rule — one last try)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of reEngageLeads || []) {
      await sendWhatsApp(lead.phone, 'reengage_v1', [
        lead.name || 'there',
      ]);
      reEngaged++;
    }

    return res.status(200).json({
      ok: true,
      leadNudges,
      droppedLeads: expiredLeads?.length || 0,
      clientNudges,
      escalations,
      reEngaged,
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function computeCurrentWeek(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}
