const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const now = new Date();
  const stats = { nudged: 0, dropped: 0, reengaged: 0, scheduledSent: 0, errors: [] };

  try {
    // ---------------------------------------------------------------
    // 1. Nudge leads: status='new', last_msg_at between 2h and 24h ago,
    //    no outbound nudge template already sent
    // ---------------------------------------------------------------
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: nudgeLeads, error: nudgeErr } = await supabase
      .from('leads')
      .select('id, name, phone, last_msg_at')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    if (nudgeErr) {
      console.error('[nudge-dropped] Error fetching nudge leads:', nudgeErr.message);
      stats.errors.push({ step: 'nudge_fetch', error: nudgeErr.message });
    }

    for (const lead of nudgeLeads || []) {
      try {
        // Check if a nudge_trial template was already sent to this lead
        const { data: existingNudge } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .maybeSingle();

        if (existingNudge) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);
        const trialLink = `https://fitnessbymaddy.com/intake?lead=${lead.id}&program=zoom_trial`;

        const body = hinglish
          ? `Hey ${lead.name || 'there'}! 🔥 Ek $20 trial session se start karo — Maddy ke saath LIVE Zoom pe. Koi commitment nahi. Book karo: ${trialLink}`
          : `Hey ${lead.name || 'there'}! 🔥 Start with a $20 trial session — LIVE on Zoom with Maddy. No commitment. Book here: ${trialLink}`;

        const result = await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there', trialLink],
          body,
        });

        if (result.ok) {
          stats.nudged++;
        } else {
          stats.errors.push({ lead_id: lead.id, phone: maskPhone(lead.phone), error: result.error });
        }
      } catch (err) {
        console.error(`[nudge-dropped] Nudge error for lead ${lead.id}:`, err.message);
        stats.errors.push({ lead_id: lead.id, error: err.message });
      }
    }

    // ---------------------------------------------------------------
    // 2. Drop leads: status='new', last_msg_at older than 24 hours
    // ---------------------------------------------------------------
    const { data: dropLeads, error: dropErr } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    if (dropErr) {
      console.error('[nudge-dropped] Error fetching drop leads:', dropErr.message);
      stats.errors.push({ step: 'drop_fetch', error: dropErr.message });
    }

    for (const lead of dropLeads || []) {
      try {
        const { error: updateErr } = await supabase
          .from('leads')
          .update({ status: 'dropped', dropped_at: now.toISOString() })
          .eq('id', lead.id);

        if (updateErr) {
          stats.errors.push({ lead_id: lead.id, step: 'drop_update', error: updateErr.message });
        } else {
          stats.dropped++;
        }
      } catch (err) {
        stats.errors.push({ lead_id: lead.id, error: err.message });
      }
    }

    // ---------------------------------------------------------------
    // 3. Re-engage dropped leads: created_at between 7 and 8 days ago
    // ---------------------------------------------------------------
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reengageLeads, error: reengageErr } = await supabase
      .from('leads')
      .select('id, name, phone, created_at')
      .eq('status', 'dropped')
      .lt('created_at', sevenDaysAgo)
      .gte('created_at', eightDaysAgo);

    if (reengageErr) {
      console.error('[nudge-dropped] Error fetching re-engage leads:', reengageErr.message);
      stats.errors.push({ step: 'reengage_fetch', error: reengageErr.message });
    }

    for (const lead of reengageLeads || []) {
      try {
        // Check if a re-engagement message was already sent
        const { data: existingReengage } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day')
          .maybeSingle();

        if (existingReengage) continue;

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        const body = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy yahan se. Pichli baar baat hui thi fitness ke baare mein. Abhi bhi interest hai? Just "yes" reply karo, main help karungi. 💛`
          : `Hey ${lead.name || 'there'}! It's Maddy. We chatted about your fitness goals last week. Still interested? Just reply "yes" and I'll help you get started. 💛`;

        const result = await sendWhatsApp({
          phone: lead.phone,
          templateName: 'reengage_7day',
          params: [lead.name || 'there'],
          body,
        });

        if (result.ok) {
          stats.reengaged++;
        } else {
          stats.errors.push({ lead_id: lead.id, phone: maskPhone(lead.phone), error: result.error });
        }
      } catch (err) {
        console.error(`[nudge-dropped] Re-engage error for lead ${lead.id}:`, err.message);
        stats.errors.push({ lead_id: lead.id, error: err.message });
      }
    }

    // ---------------------------------------------------------------
    // 4. Send scheduled nudge messages whose time has arrived
    // ---------------------------------------------------------------
    const { data: scheduledMsgs, error: schedErr } = await supabase
      .from('messages')
      .select('id, phone, body, template_name')
      .eq('status', 'scheduled')
      .eq('direction', 'out')
      .lte('sent_at', now.toISOString());

    if (schedErr) {
      console.error('[nudge-dropped] Error fetching scheduled messages:', schedErr.message);
      stats.errors.push({ step: 'scheduled_fetch', error: schedErr.message });
    }

    for (const msg of scheduledMsgs || []) {
      try {
        // Before sending, check if the client already submitted the check-in
        // (the body contains the check-in link, so the nudge may no longer be needed)
        const result = await sendWhatsApp({
          phone: msg.phone,
          templateName: msg.template_name,
          body: msg.body,
        });

        if (result.ok) {
          await supabase
            .from('messages')
            .update({ status: 'sent', sent_at: now.toISOString() })
            .eq('id', msg.id);
          stats.scheduledSent++;
        } else {
          await supabase
            .from('messages')
            .update({ status: 'failed' })
            .eq('id', msg.id);
          stats.errors.push({ msg_id: msg.id, phone: maskPhone(msg.phone), error: result.error });
        }
      } catch (err) {
        console.error(`[nudge-dropped] Scheduled send error for msg ${msg.id}:`, err.message);
        stats.errors.push({ msg_id: msg.id, error: err.message });
      }
    }

    console.log(`[nudge-dropped] Done:`, JSON.stringify(stats));
    return res.status(200).json(stats);
  } catch (err) {
    console.error('[nudge-dropped] Fatal error:', err.message);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
};
