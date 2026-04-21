const { getClient } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getClient();

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', fourteenDaysAgo);

    if (!staleLeads || staleLeads.length === 0) {
      return res.status(200).json({ ok: true, nudged: 0 });
    }

    let nudged = 0;
    for (const lead of staleLeads) {
      const result = await sendTemplate(lead.phone, 'nudge_trial', {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there'],
      }, { supabase });

      if (!result.rateLimited) {
        nudged++;
      }
    }

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, lead_id, program_started_at')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkin && checkin.length > 0) continue;

        const { data: recentMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1);

        if (recentMsg && recentMsg.length > 0) {
          const hoursSinceMsg = (Date.now() - new Date(recentMsg[0].sent_at)) / (1000 * 60 * 60);
          if (hoursSinceMsg >= 24 && hoursSinceMsg < 72) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
            const { data: lead } = await supabase
              .from('leads')
              .select('market')
              .eq('id', client.lead_id)
              .single();

            const market = lead?.market || 'GLOBAL';
            const { sendText } = require('../../lib/whatsapp');

            const msg = isHinglish(market)
              ? `Reminder: Week ${weekNo} check-in abhi tak pending hai 📝\n\n${checkinUrl}`
              : `Reminder: Your Week ${weekNo} check-in is still pending 📝\n\n${checkinUrl}`;

            await sendText(client.phone, msg, { supabase });
            checkinNudges++;
          }
        }
      }
    }

    return res.status(200).json({ ok: true, nudged, checkinNudges });
  } catch (err) {
    console.error('nudge-dropped cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
