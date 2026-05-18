const { getSupabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // Nudge leads who went silent after 2 hours (no reply to welcome)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of (silentLeads || [])) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at)
        .limit(2);

      // Only the initial message, no follow-up reply
      if (!msgs || msgs.length <= 1) {
        const trialUrl = 'https://www.fitnessbymaddy.com/program-trial.html';
        const hinglish = isHinglish(lead.market);

        if (hinglish) {
          await sendTemplate(lead.phone, 'nudge_trial_hi', [lead.name || 'there', trialUrl]);
        } else {
          await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there', trialUrl]);
        }
        nudged++;
      }
    }

    // Drop leads older than 24 hours with no reply
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gte('sent_at', lead.created_at)
        .limit(2);

      if (!replies || replies.length <= 1) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule) — one-time win-back
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: winbackLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let winback = 0;
    for (const lead of (winbackLeads || [])) {
      const { data: outMsgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .ilike('template_name', '%winback%')
        .limit(1);

      if (!outMsgs || outMsgs.length === 0) {
        const hinglish = isHinglish(lead.market);
        if (hinglish) {
          await sendTemplate(lead.phone, 'winback_hi', [lead.name || 'there']);
        } else {
          await sendTemplate(lead.phone, 'winback_en', [lead.name || 'there']);
        }
        winback++;
      }
    }

    // Nudge active clients with pending check-ins (+24h and +48h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of (pendingClients || [])) {
      const weekNo = calculateWeekNo(client.program_started_at);
      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!checkin) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const hinglish = isHinglish(client.market);

        if (hinglish) {
          await sendTemplate(client.phone, 'checkin_reminder_hi', [client.name, String(weekNo), checkinUrl]);
        } else {
          await sendTemplate(client.phone, 'checkin_reminder_en', [client.name, String(weekNo), checkinUrl]);
        }
        clientNudged++;
      }
    }

    return res.status(200).json({
      nudged,
      dropped,
      winback,
      client_nudged: clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(diffDays / 7));
}
