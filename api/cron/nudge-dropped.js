const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isServiceCall) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getClient();
  const results = { nudged: 0, skipped: 0, errors: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .gte('created_at', sevenDaysAgo)
      .lte('last_msg_at', twoDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', ...results });
    }

    for (const lead of droppedLeads) {
      try {
        const { data: recentMsgs } = await db.from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsgs && recentMsgs.length > 0) {
          results.skipped++;
          continue;
        }

        const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
        const params = lead.market === 'IN'
          ? [lead.name || 'there', '₹1,650 ($20)', trialUrl]
          : [lead.name || 'there', '$20', trialUrl];

        await sendTemplate(lead.phone, 'nudge_trial', params);
        results.nudged++;
        console.log(`Nudged: ${maskPhone(lead.phone)}`);
      } catch (err) {
        console.error(`Nudge error for ${maskPhone(lead.phone)}:`, err.message);
        results.errors++;
      }
    }

    // Also nudge active clients with pending check-ins
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgoDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await db
      .from('messages')
      .select('phone, template_name, sent_at')
      .eq('template_name', 'checkin_reminder')
      .eq('direction', 'out')
      .gte('sent_at', twoDaysAgoDate)
      .lte('sent_at', oneDayAgo);

    if (pendingCheckins) {
      for (const msg of pendingCheckins) {
        const { data: client } = await db.from('clients')
          .select('id, name, phone')
          .eq('phone', msg.phone)
          .eq('status', 'active')
          .single();

        if (!client) continue;

        const startDate = new Date(msg.sent_at);
        const weekNo = Math.ceil((new Date() - startDate) / (7 * 24 * 60 * 60 * 1000));

        const { data: submitted } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .gte('form_submitted_at', twoDaysAgoDate)
          .limit(1);

        if (!submitted || submitted.length === 0) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            checkinUrl,
          ]);
        }
      }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
