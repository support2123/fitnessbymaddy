const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  const db = getSupabase();

  try {
    const now = new Date();

    // Nudge leads that haven't replied: 2hr and 24hr mark
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2-hour nudge for new leads with no reply
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/intake?lead=' + lead.id,
        ]);
        nudged++;
      }
    }

    // 24-hour drop for leads still status=new
    const { data: staleLeads } = await db
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo)
      .gte('created_at', sevenDaysAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // 7-day re-engagement for dropped leads (once only)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString())
      .lte('created_at', sevenDaysAgo);

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengageMsgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageMsgs && reengageMsgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'reengage_7day', [
          lead.name || 'there',
        ]);
        reengaged++;
      }
    }

    // Missed check-in nudges (+24hr, +48hr)
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        const daysSinceSunday = now.getDay();
        if (daysSinceSunday >= 1 && daysSinceSunday <= 2) {
          await sendWhatsApp(client.phone, 'checkin_reminder', [
            client.name || 'there',
            currentWeek.toString(),
            `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`,
          ]);
          checkinNudges++;
        }

        if (daysSinceSunday >= 2) {
          const { data: prevCheckins } = await db
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .order('week_no', { ascending: false })
            .limit(2);

          const missedConsecutive =
            prevCheckins &&
            prevCheckins.length > 0 &&
            prevCheckins[0].week_no < currentWeek - 1;

          if (missedConsecutive) {
            await db.from('escalations').insert({
              phone: client.phone,
              client_id: client.id,
              reason: `2 consecutive missed check-ins (current week: ${currentWeek})`,
            });
          }
        }
      }
    }

    return json(res, {
      ok: true,
      nudged,
      dropped,
      reengaged,
      checkinNudges,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
