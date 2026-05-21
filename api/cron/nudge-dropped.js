const { supabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();

    // Nudge new leads with no reply after 2 hours
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!msgs || msgs.length === 0) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    for (const lead of (deadLeads || [])) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at)
        .limit(1);

      if (!msgs || msgs.length === 0) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads from 7 days ago (one-time soft nudge)
    const sevenDaysWindow = new Date(now - 8 * 86400000).toISOString();
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .gt('last_msg_at', sevenDaysWindow)
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const { data: recentOut } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7d')
        .limit(1);

      if (!recentOut || recentOut.length === 0) {
        await sendTemplate(lead.phone, 'reengage_7d', [lead.name || 'there']);
        reEngaged++;
      }
    }

    // Nudge active clients with pending check-ins (+24hrs, +48hrs)
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;
    for (const client of (pendingClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));
      const dayInWeek = daysSinceStart % 7;

      if (dayInWeek !== 1 && dayInWeek !== 2) continue;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (!checkin) {
        const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl
        ]);
        checkinNudged++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged,
      dropped,
      reEngaged,
      checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
