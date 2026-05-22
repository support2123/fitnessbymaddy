import supabase from '../../lib/supabase.js';
import { sendTemplate, sendText, canSendMessage } from '../../lib/whatsapp.js';
import { isHinglishMarket } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();

    // Nudge leads that went silent 2 hours ago (no reply after welcome)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Mark leads as dropped if no reply in 24 hours
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    // Send 2-hour nudge to new leads who haven't replied
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (silentLeads) {
      for (const lead of silentLeads) {
        const { data: outMsgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', twoHoursAgo);

        if (outMsgs && outMsgs.length > 0) continue;

        const isIN = isHinglishMarket(lead.market);
        const trialUrl = 'https://fitnessbymaddy.com/shred.html';

        const msg = isIN
          ? `Hey ${lead.name || 'there'}! Ek $20 trial session try karo — full workout + nutrition guidance milega. Interested?\n\n${trialUrl}`
          : `Hey ${lead.name || 'there'}! Try a $20 trial session — you'll get a full workout + nutrition guidance. Interested?\n\n${trialUrl}`;

        await sendText(lead.phone, msg);
        nudged++;
      }
    }

    // Re-engage dropped leads that are 7+ days old (one-time attempt)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: recentOut } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gt('sent_at', sevenDaysAgo);

        if (recentOut && recentOut.length > 0) continue;

        const isIN = isHinglishMarket(lead.market);
        const msg = isIN
          ? `Hi ${lead.name || 'there'}! Abhi bhi fitness goals pe kaam karna hai? Maddy ke programs check karo — naya batch jaldi start ho raha hai!`
          : `Hi ${lead.name || 'there'}! Still thinking about your fitness goals? Check out Maddy's programs — a new batch is starting soon!`;

        await sendText(lead.phone, msg);
        reengaged++;
      }
    }

    // Nudge active clients who haven't submitted check-in
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        const dayOfWeek = now.getDay();

        // Nudge on Mon (1) and Tue (2) if check-in not submitted for current week
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        const isIN = isHinglishMarket(client.phone?.startsWith('91') ? 'IN' : 'GLOBAL');

        const msg = isIN
          ? `Reminder: Week ${currentWeek} ka check-in abhi tak pending hai. Jaldi bharo!\n${checkinUrl}`
          : `Reminder: Your Week ${currentWeek} check-in is still pending. Please submit it!\n${checkinUrl}`;

        await sendText(client.phone, msg);
        clientNudged++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      nudged,
      reengaged,
      client_nudged: clientNudged
    });

  } catch (err) {
    console.error('Nudge cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
