const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

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
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', eightDaysAgo)
      .lte('last_msg_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: recentMessages } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMessages && recentMessages.length > 0) continue;

        const hinglish = isHinglish(lead.market || 'GLOBAL');
        const trialLink = 'https://www.fitnessbymaddy.com/program-trial.html';

        const msgBody = hinglish
          ? `Hey ${lead.name || 'there'}! Maddy ka $20 trial try karna chahoge? Ek Zoom session se start karo: ${trialLink}`
          : `Hey ${lead.name || 'there'}! Want to try Maddy's $20 trial? Start with one Zoom session: ${trialLink}`;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there', trialLink],
          body: msgBody
        });

        nudged++;
      }
    }

    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: checkin } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const { data: recentNudge } = await db
          .from('messages')
          .select('id')
          .eq('phone', client.phone)
          .eq('template_name', 'checkin_nudge')
          .gte('sent_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (recentNudge && recentNudge.length > 0) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_nudge',
          params: [client.name || 'there', String(currentWeek), checkinUrl],
          body: `Reminder: Your Week ${currentWeek} check-in is pending! ${checkinUrl}`
        });

        checkinNudges++;
      }
    }

    return res.status(200).json({
      message: 'Nudge cron completed',
      leadsNudged: nudged,
      checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
