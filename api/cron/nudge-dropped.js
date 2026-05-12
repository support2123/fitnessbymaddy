const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // FLOW A nudge: Leads with status=new, no reply after 2 hours
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const { data: staleNewLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo)
    .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  let nudged = 0;
  for (const lead of (staleNewLeads || [])) {
    // Check if we already sent a nudge
    const { data: nudgeMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'nudge_trial')
      .limit(1);

    if (nudgeMsg && nudgeMsg.length > 0) continue;

    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);

    const body = hinglish
      ? `Hey ${lead.name || ''} 👋 Ek baar try toh karo! Maddy ke saath $20 trial session — full workout + nutrition guidance.\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nBas ek step door ho results se! 🔥`
      : `Hey ${lead.name || ''} 👋 Why not give it a try? Get a $20 trial session with Maddy — full workout + nutrition guidance.\n\nhttps://fitnessbymaddy.com/program-trial.html\n\nYou're one step away from real results! 🔥`;

    await sendWhatsApp({
      phone: lead.phone,
      body,
      templateName: 'nudge_trial'
    });

    nudged++;
  }

  // Mark leads as dropped after 24 hours of no reply
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: expiredLeads } = await db
    .from('leads')
    .select('id')
    .eq('status', 'new')
    .lte('created_at', twentyFourHoursAgo);

  if (expiredLeads && expiredLeads.length > 0) {
    const ids = expiredLeads.map(l => l.id);
    await db.from('leads').update({ status: 'dropped' }).in('id', ids);
  }

  // Re-engage dropped leads (7-day rule)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reengageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'dropped')
    .lte('last_msg_at', sevenDaysAgo)
    .gte('last_msg_at', eightDaysAgo);

  let reengaged = 0;
  for (const lead of (reengageLeads || [])) {
    // Only re-engage once
    const { data: reengageMsg } = await db
      .from('messages')
      .select('id')
      .eq('phone', lead.phone)
      .eq('template_name', 'reengage_7d')
      .limit(1);

    if (reengageMsg && reengageMsg.length > 0) continue;

    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);

    const body = hinglish
      ? `Hey ${lead.name || ''}, abhi bhi goal same hai? 💪\n\nMaddy ke programs mein limited spots hain. Agar serious ho toh reply karo — hum best plan suggest karenge!`
      : `Hey ${lead.name || ''}, still thinking about your fitness goals? 💪\n\nSpots in Maddy's programs are limited. Reply if you're ready — we'll find the best fit for you!`;

    await sendWhatsApp({
      phone: lead.phone,
      body,
      templateName: 'reengage_7d'
    });

    reengaged++;
  }

  // Nudge active clients with pending check-ins (+24hr and +48hr)
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;
  for (const client of (activeClients || [])) {
    const started = new Date(client.program_started_at);
    const daysSinceStart = Math.floor((now - started) / (1000 * 60 * 60 * 24));
    const weekNo = Math.floor(daysSinceStart / 7) + 1;

    // Only nudge if today is Mon or Tue (1-2 days after Sunday check-in send)
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

    const { data: checkin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (checkin) continue;

    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const body = hinglish
      ? `Reminder! 📋 Week ${weekNo} check-in abhi tak pending hai.\n\n${checkinUrl}\n\nBas 2 min lagenge!`
      : `Reminder! 📋 Your Week ${weekNo} check-in is still pending.\n\n${checkinUrl}\n\nIt only takes 2 minutes!`;

    await sendWhatsApp({
      phone: client.phone,
      body,
      templateName: 'checkin_nudge',
      isClient: true
    });

    clientNudges++;
  }

  return res.status(200).json({
    success: true,
    nudged,
    dropped: expiredLeads?.length || 0,
    reengaged,
    client_nudges: clientNudges
  });
};
