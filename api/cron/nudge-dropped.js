const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const now = new Date();

  const { data: activeClients } = await db
    .from('clients')
    .select('id, phone, name')
    .eq('status', 'active');

  let nudgedCheckins = 0;
  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at || now);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        const { data: lastMsg } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .eq('template_name', 'checkin_nudge')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        const lastNudge = lastMsg ? new Date(lastMsg.sent_at) : null;
        const hoursSinceNudge = lastNudge ? (now - lastNudge) / (1000 * 60 * 60) : 999;

        if (hoursSinceNudge >= 24) {
          await sendTemplate(client.phone, 'checkin_nudge', [client.name || 'there']);
          await logMessage(client.phone, 'out', '[Check-in nudge]', 'checkin_nudge');
          nudgedCheckins++;
        }
      }
    }
  }

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: reEngageLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', sevenDaysAgo)
    .gte('created_at', fourteenDaysAgo);

  let reEngaged = 0;
  if (reEngageLeads) {
    for (const lead of reEngageLeads) {
      const { data: msgCount } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('template_name', 're_engage')
        .limit(1);

      if (!msgCount || msgCount.length === 0) {
        await sendTemplate(lead.phone, 're_engage', [lead.name || 'there']);
        await logMessage(lead.phone, 'out', '[Re-engagement]', 're_engage');
        reEngaged++;
      }
    }
  }

  return res.status(200).json({
    message: 'Nudge cycle complete',
    nudged_checkins: nudgedCheckins,
    re_engaged_leads: reEngaged
  });
};
