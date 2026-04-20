const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish, detectMarket } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;

  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { nudged: 0, skipped: 0, errors: 0 };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped 7-14 days ago (one attempt only)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', results });
    }

    for (const lead of droppedLeads) {
      try {
        const { data: nudgesSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_dropped')
          .limit(1);

        if (nudgesSent && nudgesSent.length > 0) {
          results.skipped++;
          continue;
        }

        const market = detectMarket(lead.phone);
        const hinglish = isHinglish(market);

        if (hinglish) {
          await sendTemplate(lead.phone, 'reengage_dropped', [
            lead.name || 'there',
            "Hey! Maddy ki team yahan. Abhi bhi interested ho fitness mein? Ek $20 trial session try karo — no commitment!"
          ]);
        } else {
          await sendTemplate(lead.phone, 'reengage_dropped', [
            lead.name || 'there',
            "Hey! Still thinking about your fitness goals? Try a $20 trial session — no commitment, no pressure."
          ]);
        }

        results.nudged++;
      } catch (leadErr) {
        console.error(`Nudge error for lead ${lead.id}:`, leadErr.message);
        results.errors++;
      }
    }

    // Also nudge active clients who haven't submitted check-ins
    const { data: pendingClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (pendingClients || [])) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id, form_submitted_at')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        // Check if we already sent a nudge for this week
        const { data: nudgeSent } = await db
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge')
          .gte('sent_at', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (nudgeSent && nudgeSent.length > 0) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);

        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            `Week ${currentWeek} check-in abhi tak nahi aaya! Jaldi bharo:`,
            checkinUrl
          ]);
        } else {
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            `Your Week ${currentWeek} check-in is still pending! Submit it here:`,
            checkinUrl
          ]);
        }

        results.nudged++;
      } catch (e) {
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
