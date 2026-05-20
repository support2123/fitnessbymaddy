const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket } = require('../_lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge leads that went silent after 2 hours (new leads only)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Flow A step 3: 2hr nudge for new leads
  const { data: silentLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .eq('opted_out', false)
    .lt('last_msg_at', twoHoursAgo)
    .gt('last_msg_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;
  let reengaged = 0;

  if (silentLeads) {
    for (const lead of silentLeads) {
      const market = detectMarket(lead.phone);
      const isHinglish = market === 'IN';

      const msg = isHinglish
        ? `Hey! 👋 Abhi decide nahi kar pa rahe? Koi baat nahi — $20 mein ek trial Zoom session try karo. Zero risk.\n\nhttps://www.fitnessbymaddy.com/shred.html`
        : `Hey! 👋 Not sure yet? No worries — try a $20 trial Zoom session. Zero risk.\n\nhttps://www.fitnessbymaddy.com/shred.html`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        body: msg,
        params: [lead.name || 'there']
      });

      if (result.sent) nudged++;
    }
  }

  // Flow A step 4: 24hr drop
  const { data: expiredLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .eq('opted_out', false)
    .lt('last_msg_at', twentyFourHoursAgo)
    .gt('created_at', sevenDaysAgo);

  if (expiredLeads) {
    for (const lead of expiredLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  // Re-engage dropped leads (7-day rule: only re-engage once after 7 days)
  const exactlySevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

  const { data: droppedLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .eq('opted_out', false)
    .lt('last_msg_at', exactlySevenDaysAgo.toISOString())
    .gt('last_msg_at', eightDaysAgo.toISOString());

  if (droppedLeads) {
    for (const lead of droppedLeads) {
      const { data: msgCount } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day');

      if (msgCount && msgCount.length > 0) continue;

      const market = detectMarket(lead.phone);
      const isHinglish = market === 'IN';

      const msg = isHinglish
        ? `Hey ${lead.name || 'there'}! Maddy ki team se. 🙌\n\nHumne notice kiya tum interested the fitness mein. Abhi bhi goal same hai? Reply karo, hum help karenge! 💪`
        : `Hey ${lead.name || 'there'}! From Maddy's team. 🙌\n\nWe noticed you were interested in fitness coaching. Still working towards that goal? Reply and we'll help! 💪`;

      const result = await sendWhatsApp({
        phone: lead.phone,
        templateName: 'reengage_7day',
        body: msg,
        params: [lead.name || 'there']
      });

      if (result.sent) reengaged++;
    }
  }

  return res.status(200).json({
    message: 'Nudge cron complete',
    nudged, dropped, reengaged
  });
};
