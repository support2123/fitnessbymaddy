const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // FLOW A step 3: Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', oneDayAgo);

    let nudged = 0;
    let dropped = 0;

    for (const lead of staleNewLeads || []) {
      // Check if we already nudged (look for nudge_trial in messages)
      const { data: nudgeMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'nudge_trial')
        .single();

      if (nudgeMsg) {
        // Already nudged — check if 24hrs since creation to drop
        if (new Date(lead.created_at) < new Date(oneDayAgo)) {
          await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
        continue;
      }

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? ['Hey! 👋 Ek $20 trial session try karna chahoge? Maddy ke saath live Zoom pe.\nhttps://www.fitnessbymaddy.com/program-trial.html']
        : ['Hey! 👋 Want to try a $20 trial session? Live on Zoom with Maddy.\nhttps://www.fitnessbymaddy.com/program-trial.html'];

      await sendWhatsApp(lead.phone, 'nudge_trial', params);
      nudged++;
    }

    // Re-engage dropped leads (7-day rule: one attempt only)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gt('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    for (const lead of droppedLeads || []) {
      // Check if already re-engaged
      const { data: reengageMsg } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 'reengage_7day')
        .single();

      if (reengageMsg) continue;

      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      const params = hinglish
        ? ['Hey! 😊 Abhi bhi fitness goals pe kaam karna hai? Maddy ka $20 trial try karo — no commitment.\nhttps://www.fitnessbymaddy.com/program-trial.html']
        : ['Hey! 😊 Still thinking about your fitness goals? Try Maddy\'s $20 trial — no commitment.\nhttps://www.fitnessbymaddy.com/program-trial.html'];

      await sendWhatsApp(lead.phone, 'reengage_7day', params);
      reengaged++;
    }

    // Nudge active clients who haven't submitted check-in (+24h, +48h)
    let clientNudged = 0;
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysSinceStart / 7) + 1;

      // Only nudge on Monday (day after Sunday send) and Tuesday
      const dayOfWeek = now.getDay(); // 0=Sun
      if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const nudgeTemplate = dayOfWeek === 1 ? 'checkin_nudge_24h' : 'checkin_nudge_48h';
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, nudgeTemplate, [
        `Reminder: Week ${weekNo} check-in pending! 📋\n${checkinUrl}`,
      ]);
      clientNudged++;
    }

    return res.status(200).json({
      action: 'nudge_complete',
      nudged,
      dropped,
      reengaged,
      clientNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
