const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads that were dropped 2-7 days ago (7-day rule)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .lt('last_msg_at', twoDaysAgo)
      .gt('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge' });
    }

    const results = [];

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone, false);
      if (!allowed) {
        results.push({ lead_id: lead.id, action: 'rate_limited' });
        continue;
      }

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there'
      ]);

      results.push({ lead_id: lead.id, action: 'nudge_sent' });
    }

    // Also nudge active clients who haven't submitted check-ins
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .limit(1);

        if (!checkin || checkin.length === 0) {
          const { data: lastMsg } = await supabase
            .from('messages')
            .select('sent_at, template_name')
            .eq('phone', client.phone)
            .eq('direction', 'out')
            .order('sent_at', { ascending: false })
            .limit(1);

          if (lastMsg && lastMsg.length > 0) {
            const hoursSince = (Date.now() - new Date(lastMsg[0].sent_at).getTime()) / (1000 * 60 * 60);
            if (hoursSince >= 24 && hoursSince < 72) {
              const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
              await sendTemplate(client.phone, 'checkin_reminder', [
                client.name || 'there',
                checkinUrl
              ]);
              results.push({ client_id: client.id, action: 'checkin_nudge' });
            }
          }
        }
      }
    }

    return res.status(200).json({ success: true, processed: results.length, results });

  } catch (err) {
    console.error('[cron/nudge-dropped]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
