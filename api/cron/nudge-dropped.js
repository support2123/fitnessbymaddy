const { supabase } = require('../../lib/supabase');
const { sendMessage } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;

    // --- Part 1: Nudge new leads with no reply after 2 hours ---
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);

    for (const lead of staleNewLeads || []) {
      // Check if we already sent a nudge (look for nudge_trial in messages)
      const { data: nudgesSent } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (nudgesSent && nudgesSent.length > 0) continue;

      const market = detectMarket(lead.phone);
      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

      const msg = isHinglish(market)
        ? `Hey! 👋 Abhi decide nahi kar pa rahe? Ek $20 trial session se start karo — no commitment.\n\n👉 ${trialUrl}`
        : `Hey! 👋 Not sure yet? Start with a $20 trial session — no commitment.\n\n👉 ${trialUrl}`;

      await sendMessage(lead.phone, { template: 'nudge_trial', text: msg });
      nudged++;
    }

    // --- Part 2: Drop leads with no reply after 24 hours ---
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of deadLeads || []) {
      // Verify no incoming messages after the welcome
      const { data: replies } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if (!replies || replies.length === 0) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // --- Part 3: Nudge active clients with pending check-ins ---
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      // Check if check-in is pending (Sunday is day 0 of the week)
      const dayOfWeek = now.getDay(); // 0=Sun
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue; // Only nudge Mon/Tue

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue; // Already submitted

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = isHinglish(market)
        ? `⏰ Reminder: Week ${weekNo} ka check-in abhi tak pending hai!\n\n👉 ${checkinUrl}\n\nBas 5 min lagenge — it helps us make your next plan better!`
        : `⏰ Reminder: Your Week ${weekNo} check-in is still pending!\n\n👉 ${checkinUrl}\n\nJust 5 minutes — it helps us optimize your next plan!`;

      await sendMessage(client.phone, { text: msg, isClient: true });
      checkinNudges++;
    }

    // --- Part 4: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gt('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of reEngageLeads || []) {
      // Only re-engage once
      const { data: reEngageMsgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day');

      if (reEngageMsgs && reEngageMsgs.length > 0) continue;

      const market = detectMarket(lead.phone);
      const msg = isHinglish(market)
        ? `Hi again! 🙌 Maddy ke paas abhi limited slots hain 6-week challenge ke liye. Interested ho toh reply karo — we\'ll save a spot for you!`
        : `Hi again! 🙌 Maddy has limited spots open for the 6-week challenge. Reply if you\'re interested — we\'ll save a spot for you!`;

      await sendMessage(lead.phone, { template: 'reengage_7day', text: msg });
      reEngaged++;
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      checkinNudges,
      reEngaged,
    });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
