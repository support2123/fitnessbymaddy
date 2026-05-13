const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { notifyMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // Nudge leads who haven't replied (2hr and 24hr windows)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // 2-hour nudge for new leads with no reply
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of newLeads || []) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (count === 0) {
        const params = isHinglish(lead.market)
          ? ['Ek $20 trial se shuru karo — Zoom pe Maddy ke saath live session!\nhttps://fitnessbymaddy.com/program-trial.html']
          : ['Start with a $20 trial — live Zoom session with Maddy!\nhttps://fitnessbymaddy.com/program-trial.html'];

        await sendWhatsApp(lead.phone, 'nudge_trial', params);
        nudged++;
      }
    }

    // 24-hour drop for unresponsive leads
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let dropped = 0;
    for (const lead of staleLeads || []) {
      const { count } = await db
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (count === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Check for clients with 2 consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (7 * 86400000));

      if (currentWeek >= 3) {
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2);

        if (!recentCheckins?.length || recentCheckins.length === 0) {
          await notifyMaddy('2 consecutive missed check-ins', {
            phone: client.phone,
            name: client.name,
            program: client.program,
            currentWeek,
          });
        }
      }
    }

    return res.status(200).json({ nudged, dropped });
  } catch (err) {
    console.error('[cron/nudge-dropped]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
