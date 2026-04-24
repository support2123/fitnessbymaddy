const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { detectMarket, isHinglish } = require('../../lib/market');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_AGO_MS = 2 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const results = { nudged_leads: 0, nudged_checkins: 0, skipped: 0 };

  try {
    await nudgeDroppedLeads(supabase, results);
    await nudgePendingCheckins(supabase, results);

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function nudgeDroppedLeads(supabase, results) {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const twoHoursAgo = new Date(Date.now() - TWO_HOURS_AGO_MS).toISOString();

  const { data: newLeads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('last_msg_at', twoHoursAgo)
    .gt('created_at', sevenDaysAgo);

  if (newLeads) {
    for (const lead of newLeads) {
      const market = detectMarket(lead.phone);

      const { data: recentMsgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (recentMsgs && recentMsgs.length > 0) {
        const daysSinceCreation = (Date.now() - new Date(lead.created_at)) / (1000 * 60 * 60 * 24);
        if (daysSinceCreation > 1) {
          await supabase
            .from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          results.skipped++;
          continue;
        }
        results.skipped++;
        continue;
      }

      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
        ], { supabase });
      } else {
        await sendTemplate(lead.phone, 'nudge_trial_en', [
          lead.name || 'there',
        ], { supabase });
      }
      results.nudged_leads++;
    }
  }

  const { data: staleLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lt('created_at', sevenDaysAgo);

  if (staleLeads) {
    for (const lead of staleLeads) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
    }
  }
}

async function nudgePendingCheckins(supabase, results) {
  const now = new Date().toISOString();

  const { data: nudges } = await supabase
    .from('scheduled_nudges')
    .select('*, clients(*)')
    .or(`and(nudge_24h_sent.eq.false,nudge_24h_at.lt.${now}),and(nudge_48h_sent.eq.false,nudge_48h_at.lt.${now})`);

  if (!nudges) return;

  for (const nudge of nudges) {
    const { data: checkin } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', nudge.client_id)
      .eq('week_no', nudge.week_no)
      .limit(1);

    if (checkin && checkin.length > 0) {
      await supabase
        .from('scheduled_nudges')
        .update({ nudge_24h_sent: true, nudge_48h_sent: true })
        .eq('id', nudge.id);
      results.skipped++;
      continue;
    }

    const client = nudge.clients;
    if (!client) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${nudge.client_id}&w=${nudge.week_no}`;
    const market = detectMarket(client.phone);

    if (!nudge.nudge_24h_sent && new Date(nudge.nudge_24h_at) < new Date()) {
      const msg = isHinglish(market)
        ? `Hey ${client.name}! Check-in form bharna bhool gaye kya? Ye raha link: ${checkinUrl}`
        : `Hey ${client.name}! Don't forget your weekly check-in: ${checkinUrl}`;

      await sendText(client.phone, msg, { supabase });
      await supabase
        .from('scheduled_nudges')
        .update({ nudge_24h_sent: true })
        .eq('id', nudge.id);
      results.nudged_checkins++;
    }

    if (!nudge.nudge_48h_sent && new Date(nudge.nudge_48h_at) < new Date()) {
      const msg = isHinglish(market)
        ? `${client.name}, last reminder — check-in form abhi bhar do toh next week ka plan time pe milega: ${checkinUrl}`
        : `${client.name}, final reminder — submit your check-in so your next week's plan is ready on time: ${checkinUrl}`;

      await sendText(client.phone, msg, { supabase });
      await supabase
        .from('scheduled_nudges')
        .update({ nudge_48h_sent: true })
        .eq('id', nudge.id);
      results.nudged_checkins++;
    }
  }
}
