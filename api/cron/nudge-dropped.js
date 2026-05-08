const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone, detectMarket, getLanguage } = require('../../lib/helpers');

// Runs daily: re-engages dropped leads (7-day rule) and nudges pending check-ins
module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged_leads: 0, nudged_checkins: 0, escalated: 0 };

  // === PART 1: Nudge new leads that haven't replied in 2 hours ===
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Leads that are still "new" and were created 2+ hours ago but < 24 hours ago
  const { data: staleLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lt('created_at', twoHoursAgo)
    .gt('created_at', twentyFourHoursAgo);

  if (staleLeads) {
    for (const lead of staleLeads) {
      // Check if we already nudged (sent more than 1 outbound message)
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out');

      if (msgs && msgs.length >= 2) continue; // Already nudged

      const market = detectMarket(lead.phone);
      const lang = getLanguage(market);
      const templateName = lang === 'hinglish' ? 'nudge_trial_hi' : 'nudge_trial_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://www.fitnessbymaddy.com/program-trial.html'
      ]);
      results.nudged_leads++;
    }
  }

  // Leads that are "new" and older than 24 hours → mark as dropped
  const { data: expiredLeads } = await db
    .from('leads')
    .select('id, phone')
    .eq('status', 'new')
    .lt('created_at', twentyFourHoursAgo);

  if (expiredLeads) {
    for (const lead of expiredLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
    }
  }

  // === PART 2: Re-engage dropped leads after 7 days (one-time) ===
  const { data: reengageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lt('last_msg_at', sevenDaysAgo)
    .gt('last_msg_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());

  if (reengageLeads) {
    for (const lead of reengageLeads) {
      // Only re-engage once: check if we sent after they were dropped
      const { data: postDropMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', lead.last_msg_at);

      if (postDropMsgs && postDropMsgs.length > 0) continue;

      const market = detectMarket(lead.phone);
      const lang = getLanguage(market);
      const templateName = lang === 'hinglish' ? 'reengage_7day_hi' : 'reengage_7day_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there'
      ]);
      results.nudged_leads++;
    }
  }

  // === PART 3: Nudge active clients with pending check-ins ===
  const sundayMidnight = getLastSunday();
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      // Check if check-in was submitted this week
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      // Check how many nudges sent this week
      const { data: nudgeMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .ilike('template_name', '%checkin%')
        .gt('sent_at', sundayMidnight.toISOString());

      const nudgeCount = nudgeMsgs?.length || 0;

      if (nudgeCount === 0) continue; // Initial was already sent by weekly-checkin cron
      if (nudgeCount >= 3) {
        // 2 consecutive missed check-ins → escalate
        const { data: prevCheckin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .limit(1);

        if (!prevCheckin || prevCheckin.length === 0) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            client.phone,
            `Client: ${client.name}, missed weeks ${weekNo - 1} and ${weekNo}`
          );
          results.escalated++;
        }
        continue;
      }

      // Send nudge (+24h or +48h)
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const lang = getLanguage(market);
      const templateName = lang === 'hinglish' ? 'checkin_nudge_hi' : 'checkin_nudge_en';

      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        checkinUrl
      ]);
      results.nudged_checkins++;
    }
  }

  console.log(`Nudge cron complete: ${JSON.stringify(results)}`);
  return res.status(200).json({ success: true, ...results });
};

function getLastSunday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 0 : day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - diff);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}
