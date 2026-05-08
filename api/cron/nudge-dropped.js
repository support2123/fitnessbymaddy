const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, getNudgeMessage } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // --- Part 1: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    const reEngageResults = [];
    for (const lead of (reEngageLeads || [])) {
      const { data: alreadySent } = await db.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 're_engage')
        .limit(1);

      if (alreadySent && alreadySent.length > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const nudgeMsg = getNudgeMessage(market);

      await sendWhatsApp(lead.phone, 're_engage', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there']
      }, nudgeMsg);

      reEngageResults.push({ phone: lead.phone, action: 'nudged' });
    }

    // --- Part 2: Nudge pending check-ins (24h / 48h) ---
    const { data: pendingNudges } = await db.from('nudge_queue')
      .select('*')
      .is('sent_at', null);

    const nudgeResults = [];
    for (const nudge of (pendingNudges || [])) {
      const { data: submitted } = await db.from('checkins')
        .select('id')
        .eq('client_id', nudge.client_id)
        .eq('week_no', nudge.week_no)
        .single();

      if (submitted) {
        await db.from('nudge_queue').update({ sent_at: now.toISOString() }).eq('id', nudge.id);
        continue;
      }

      const shouldNudge24 = nudge.nudge_at_24h && new Date(nudge.nudge_at_24h) <= now;
      const shouldNudge48 = nudge.nudge_at_48h && new Date(nudge.nudge_at_48h) <= now;
      const alreadyNudged24 = nudge.nudged_24h;

      if (shouldNudge48 && !nudge.nudged_48h) {
        const { data: client } = await db.from('clients')
          .select('phone, name')
          .eq('id', nudge.client_id)
          .single();

        if (client) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${nudge.client_id}&w=${nudge.week_no}`;
          await sendWhatsApp(client.phone, 'checkin_reminder_48h', {
            name: client.name
          }, `Hey ${client.name}! ⏰\n\nYour Week ${nudge.week_no} check-in is still pending. Completing it helps Maddy optimize your next week's plan.\n\n📋 ${checkinUrl}\n\nJust 2 minutes — your progress matters! 💪`);

          await db.from('nudge_queue').update({
            nudged_48h: true,
            sent_at: now.toISOString()
          }).eq('id', nudge.id);

          nudgeResults.push({ client_id: nudge.client_id, nudge: '48h' });
        }
      } else if (shouldNudge24 && !alreadyNudged24) {
        const { data: client } = await db.from('clients')
          .select('phone, name')
          .eq('id', nudge.client_id)
          .single();

        if (client) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${nudge.client_id}&w=${nudge.week_no}`;
          await sendWhatsApp(client.phone, 'checkin_reminder_24h', {
            name: client.name
          }, `Hey ${client.name}! 👋\n\nFriendly reminder — your Week ${nudge.week_no} check-in is waiting for you:\n📋 ${checkinUrl}\n\nTrack your progress to keep the momentum going! 🔥`);

          await db.from('nudge_queue').update({ nudged_24h: true }).eq('id', nudge.id);
          nudgeResults.push({ client_id: nudge.client_id, nudge: '24h' });
        }
      }
    }

    // --- Part 3: Nudge new leads (2hr no-reply) ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db.from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    const leadNudgeResults = [];
    for (const lead of (newLeads || [])) {
      const { data: replies } = await db.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (replies && replies.length > 0) continue;

      const { data: alreadyNudged } = await db.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (alreadyNudged && alreadyNudged.length > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there'
      }, getNudgeMessage(market));

      leadNudgeResults.push({ phone: lead.phone, action: 'trial_nudge' });
    }

    // --- Part 4: Mark 24hr no-reply leads as dropped ---
    const { data: staleLeads } = await db.from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    for (const lead of (staleLeads || [])) {
      const { data: replies } = await db.from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', twentyFourHoursAgo)
        .limit(1);

      if (!replies || replies.length === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      }
    }

    return res.status(200).json({
      success: true,
      re_engaged: reEngageResults.length,
      checkin_nudges: nudgeResults.length,
      trial_nudges: leadNudgeResults.length
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
