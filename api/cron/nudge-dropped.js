const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../../lib/whatsapp');
const { logMessage, canSendTo } = require('../../lib/rate-limit');
const { detectMarket, isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // FLOW A step 3: Nudge leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('id, phone, name, market, created_at, last_msg_at')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    let dropped = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const canSend = await canSendTo(lead.phone);
        if (!canSend) continue;

        const lastMsg = lead.last_msg_at || lead.created_at;
        const msSinceLastMsg = now - new Date(lastMsg);
        const hoursSinceLastMsg = msSinceLastMsg / (1000 * 60 * 60);

        if (hoursSinceLastMsg >= 24) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
          continue;
        }

        if (hoursSinceLastMsg >= 2) {
          const hinglish = isHinglish(lead.market);
          const msg = hinglish
            ? `Hey ${lead.name || 'there'}! Maddy ki team se. Agar confuse ho toh $20 trial try karo — Zoom pe Maddy ke saath:\nhttps://www.fitnessbymaddy.com/program-trial.html`
            : `Hey ${lead.name || 'there'}! Still thinking? Try Maddy's $20 Zoom trial — no commitment:\nhttps://www.fitnessbymaddy.com/program-trial.html`;

          await sendText(lead.phone, msg);
          await logMessage({
            phone: lead.phone,
            direction: 'out',
            body: msg,
            templateName: 'nudge_trial',
          });
          nudged++;
        }
      }
    }

    // Re-engage dropped leads (7-day rule)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gt('created_at', eightDaysAgo)
      .lt('created_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const canSend = await canSendTo(lead.phone);
        if (!canSend) continue;

        const { count } = await db
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if (count > 0) continue;

        const hinglish = isHinglish(lead.market);
        const msg = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ki team se. Abhi bhi interested ho fitness mein? Limited time offer: $20 trial session available hai. Reply karo agar try karna hai!`
          : `Hey ${lead.name || 'there'}! Still interested in your fitness goals? We have a limited-time $20 trial session available. Reply if you'd like to try it!`;

        await sendText(lead.phone, msg);
        await logMessage({
          phone: lead.phone,
          direction: 'out',
          body: msg,
          templateName: 'reengage_7day',
        });
        reengaged++;
      }
    }

    // Nudge active clients with pending check-ins (+24h, +48h)
    const { data: pendingClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let clientNudges = 0;

    if (pendingClients) {
      for (const client of pendingClients) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        if (weekNo < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          const msg = `Reminder: Your Week ${weekNo} check-in is still pending. Submit here: ${checkinUrl}`;
          await sendText(client.phone, msg);
          await logMessage({
            phone: client.phone,
            direction: 'out',
            body: msg,
            templateName: 'checkin_nudge',
          });
          clientNudges++;
        }
      }
    }

    return res.status(200).json({ nudged, dropped, reengaged, clientNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
