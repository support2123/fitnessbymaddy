const { getSupabase } = require('../lib/supabase');
const { sendRateLimited, sendText, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    let nudged = 0;
    let dropped = 0;
    let reEngaged = 0;

    // 1. Nudge new leads after 2 hours of no response
    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', twoHoursAgo)
          .limit(1);

        if (!replies || replies.length === 0) {
          const { data: nudges } = await db
            .from('messages')
            .select('id')
            .eq('phone', lead.phone)
            .eq('template_name', 'nudge_trial')
            .limit(1);

          if (!nudges || nudges.length === 0) {
            await sendRateLimited(lead.phone, 'nudge_trial', [lead.name || 'there'], lead.name, false);
            nudged++;
          }
        }
      }
    }

    // 2. Drop leads with no reply after 24 hours
    const { data: staleLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: replies } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at || twentyFourHoursAgo)
          .limit(1);

        const { data: msgs } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .order('sent_at', { ascending: false })
          .limit(1);

        const lastMsg = msgs?.[0]?.sent_at;
        if (!lastMsg || new Date(lastMsg) < new Date(twentyFourHoursAgo)) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // 3. Re-engage dropped leads after 7 days (one attempt only)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market, program_interest')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lte('last_msg_at', new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString());

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengageMsgs } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (!reengageMsgs || reengageMsgs.length === 0) {
          await sendRateLimited(lead.phone, 'reengage_7day', [lead.name || 'there'], lead.name, false);
          reEngaged++;
        }
      }
    }

    // 4. Check for active clients with pending check-in nudges
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
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
          .single();

        if (checkin) continue;

        const sunday = new Date(now);
        sunday.setDate(sunday.getDate() - sunday.getDay());
        sunday.setHours(3, 30, 0, 0);

        const hoursSinceSunday = (now - sunday) / (1000 * 60 * 60);

        if ((hoursSinceSunday >= 24 && hoursSinceSunday < 26) || (hoursSinceSunday >= 48 && hoursSinceSunday < 50)) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
          await sendText(client.phone,
            `Reminder: Your Week ${currentWeek} check-in is still pending! 📋\n` +
            `${checkinUrl}\n\nQuick 2-min form — helps us keep your program on track.`
          );
          checkinNudges++;
        }
      }
    }

    return res.status(200).json({
      status: 'complete',
      nudged,
      dropped,
      reEngaged,
      checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
