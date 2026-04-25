const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { jsonOk, jsonError, verifyCronSecret } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (!verifyCronSecret(req)) return jsonError(res, 'Unauthorized', 401);

  const db = getSupabase();
  const now = new Date();

  // --- NUDGE 1: New leads with no reply after 2 hours ---
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();

  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo)
    .gte('created_at', fourHoursAgo);

  let nudged2hr = 0;
  for (const lead of staleNewLeads || []) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (!replies || replies.length === 0) {
      await sendWhatsApp(lead.phone, 'nudge_trial', [
        'a quick $20 Zoom trial',
        'https://fitnessbymaddy.com/program-trial.html',
      ], true);
      nudged2hr++;
    }
  }

  // --- NUDGE 2: Mark leads as dropped after 24 hours of no reply ---
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', oneDayAgo);

  let dropped = 0;
  for (const lead of staleLeads || []) {
    const { data: replies } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('direction', 'in')
      .gt('sent_at', lead.created_at)
      .limit(1);

    if (!replies || replies.length === 0) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  // --- NUDGE 3: Re-engage dropped leads after 7 days (one-time) ---
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lte('created_at', sevenDaysAgo)
    .gte('created_at', eightDaysAgo);

  let reEngaged = 0;
  for (const lead of reEngageLeads || []) {
    const { data: reEngageMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7day')
      .limit(1);

    if (!reEngageMsg || reEngageMsg.length === 0) {
      await sendWhatsApp(lead.phone, 'reengage_7day', [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ], true);
      reEngaged++;
    }
  }

  // --- NUDGE 4: Pending check-in nudges (+24hr, +48hr) ---
  const { data: pendingClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let checkinNudged = 0;
  for (const client of pendingClients || []) {
    const startDate = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1)
      .single();

    if (checkin) continue;

    const lastSunday = new Date(now);
    lastSunday.setDate(lastSunday.getDate() - lastSunday.getDay());
    lastSunday.setHours(3, 30, 0, 0);

    const hoursSinceSunday = (now - lastSunday) / (1000 * 60 * 60);

    if (hoursSinceSunday >= 24 && hoursSinceSunday < 72) {
      const nudgeType = hoursSinceSunday >= 48 ? 'checkin_nudge_48hr' : 'checkin_nudge_24hr';

      const { data: alreadyNudged } = await db
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('template_name', nudgeType)
        .gte('sent_at', lastSunday.toISOString())
        .limit(1);

      if (!alreadyNudged || alreadyNudged.length === 0) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp(client.phone, nudgeType, [
          client.name || 'there',
          checkinUrl,
        ], true);
        checkinNudged++;
      }
    }
  }

  return jsonOk(res, { nudged2hr, dropped, reEngaged, checkinNudged });
};
