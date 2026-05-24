const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish, maskPhone } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (!req.headers['x-vercel-cron'] && process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    let nudged = 0;
    let reengaged = 0;

    // 1. Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const market = lead.market || 'GLOBAL';
        const trialLink = 'https://fitnessbymaddy.com/intake.html?trial=true&lead=' + lead.id;

        const msg = isHinglish(market)
          ? `Hey! 👋 Maddy ka $20 trial session try karo — 1 Zoom call mein pura plan milega. Koi commitment nahi!\n\n${trialLink}`
          : `Hey! 👋 Try Maddy's $20 trial session — get a full plan in 1 Zoom call. No commitment!\n\n${trialLink}`;

        const result = await sendWhatsApp({ phone: lead.phone, body: msg, templateName: 'nudge_trial' });
        if (result.success) nudged++;
      }
    }

    // 2. Mark 24hr+ unresponsive leads as dropped
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        console.log(`Dropped lead ${maskPhone(lead.phone)} — no reply in 24hrs`);
      }
    }

    // 3. Re-engage dropped leads (7-day rule: only if dropped 7+ days ago, max 1 attempt)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', fourteenDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        // Check if we already re-engaged
        const { data: reengageMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageMsg && reengageMsg.length > 0) continue;

        const market = lead.market || 'GLOBAL';
        const msg = isHinglish(market)
          ? `Hi! Maddy yahan se 👋\n\nAbhi bhi fitness goals mein interested ho? Humne naye programs launch kiye hain. Reply karo aur baat karte hain!`
          : `Hi from Maddy! 👋\n\nStill thinking about your fitness goals? We've launched some new programs. Reply and let's chat!`;

        const result = await sendWhatsApp({ phone: lead.phone, body: msg, templateName: 'reengage_7day' });
        if (result.success) reengaged++;
      }
    }

    // 4. Nudge active clients with pending check-ins (24hr and 48hr)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Find check-in reminder messages sent today that haven't been responded to
    const { data: pendingReminders } = await supabase
      .from('messages')
      .select('phone, sent_at')
      .eq('template_name', 'weekly_checkin')
      .eq('direction', 'out')
      .gt('sent_at', twoDaysAgo)
      .lt('sent_at', oneDayAgo);

    let checkinNudges = 0;
    if (pendingReminders) {
      for (const reminder of pendingReminders) {
        const { data: client } = await supabase
          .from('clients')
          .select('id, name, phone, program_started_at')
          .eq('phone', reminder.phone)
          .eq('status', 'active')
          .single();

        if (!client) continue;

        const startDate = new Date(client.program_started_at);
        const daysDiff = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysDiff / 7);

        const { data: submitted } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (submitted) continue;

        const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const nudgeMsg = `Reminder: Your Week ${weekNo} check-in is still pending! Takes just 5 min 📋\n\n${formUrl}`;

        await sendWhatsApp({ phone: client.phone, body: nudgeMsg, templateName: 'checkin_nudge' });
        checkinNudges++;
      }
    }

    return res.status(200).json({
      nudged,
      dropped: expiredLeads?.length || 0,
      reengaged,
      checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
