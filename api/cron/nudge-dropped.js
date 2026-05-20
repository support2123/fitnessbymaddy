const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const results = { nudged: 0, skipped: 0 };

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.json({ message: 'No leads to nudge', ...results });
    }

    for (const lead of droppedLeads) {
      try {
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .gte('sent_at', sevenDaysAgo)
          .limit(1);

        if (recentMsg && recentMsg.length > 0) {
          results.skipped++;
          continue;
        }

        const market = lead.market || 'GLOBAL';
        const params = market === 'IN'
          ? [`Hey ${lead.name || 'there'}! Maddy ka $20 trial session abhi bhi available hai — bas ek chance do 💪`]
          : [`Hey ${lead.name || 'there'}! Maddy's $20 trial session is still available — give it a shot 💪`];

        await sendWhatsApp(lead.phone, 'nudge_trial', params);
        results.nudged++;
      } catch (err) {
        console.error(`Nudge failed for ${maskPhone(lead.phone)}:`, err.message);
      }
    }

    const now = new Date();
    const { data: pendingCheckins } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
        const dayOfWeek = now.getDay();

        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const { data: checkin } = await db
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo)
            .single();

          if (!checkin) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
            await sendWhatsApp(client.phone, 'checkin_reminder', [
              `Reminder: Week ${weekNo} check-in is still pending!`,
              checkinUrl,
            ]);
          }
        }
      }
    }

    return res.json({ success: true, ...results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
