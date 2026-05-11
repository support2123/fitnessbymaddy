const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'unauthorized' }, 401);
  }

  const db = getSupabase();
  const now = new Date();

  // --- Phase 1: Nudge new leads with no reply after 2 hours ---
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo);

  let nudged = 0;
  if (staleNewLeads) {
    for (const lead of staleNewLeads) {
      // Check if we already sent a nudge (look for nudge_trial in messages)
      const { data: nudgeMsg } = await db
        .from('messages')
        .select('id')
        .ilike('phone', `%${lead.phone.slice(-3)}`)
        .eq('template_name', 'nudge_trial')
        .single();

      if (nudgeMsg) continue;

      // Check if 24 hours passed → drop
      const createdAt = new Date(lead.created_at);
      const hoursSinceCreated = (now - createdAt) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        continue;
      }

      await sendWhatsApp(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ],
      });
      nudged++;
    }
  }

  // --- Phase 2: Re-engage dropped leads (7-day rule) ---
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', fourteenDaysAgo);

  let reengaged = 0;
  if (droppedLeads) {
    for (const lead of droppedLeads) {
      // Check if we already re-engaged
      const { data: reengageMsg } = await db
        .from('messages')
        .select('id')
        .ilike('phone', `%${lead.phone.slice(-3)}`)
        .eq('template_name', 'reengage_7day')
        .single();

      if (reengageMsg) continue;

      await sendWhatsApp(lead.phone, 'reengage_7day', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      });
      reengaged++;
    }
  }

  // --- Phase 3: Nudge clients who haven't submitted check-in (+24hr, +48hr) ---
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudged = 0;
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

      // Only nudge on Monday (+24hr) and Tuesday (+48hr)
      const dayOfWeek = now.getDay();
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      await sendWhatsApp(client.phone, 'checkin_reminder', {
        name: client.name || 'there',
        templateParams: [
          client.name || 'there',
          String(currentWeek),
          `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`,
        ],
      });
      clientNudged++;
    }
  }

  return json(res, {
    ok: true,
    nudged_new_leads: nudged,
    reengaged_dropped: reengaged,
    nudged_clients: clientNudged,
  });
};
