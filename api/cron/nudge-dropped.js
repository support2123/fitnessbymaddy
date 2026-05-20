const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    let nudged = 0;

    // 0. New leads with no reply after 2 hours → nudge trial
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    if (silentLeads) {
      for (const lead of silentLeads) {
        const { data: replied } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (replied && replied.length > 0) continue;

        const { data: alreadyNudged } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (alreadyNudged && alreadyNudged.length > 0) {
          // Already nudged, check if 24h passed → drop
          const leadAge = now.getTime() - new Date(lead.created_at).getTime();
          if (leadAge > 24 * 60 * 60 * 1000) {
            await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          }
          continue;
        }

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [lead.name || 'there'],
          bypassRateLimit: true
        });
        nudged++;
      }
    }

    // 1. Re-engage leads dropped 3-7 days ago (one-time nudge)
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', sevenDaysAgo)
      .lte('last_msg_at', threeDaysAgo);

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        // Check if we already nudged
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_reengage')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_reengage',
          params: [lead.name || 'there'],
          bypassRateLimit: true
        });
        nudged++;
      }
    }

    // 2. Nudge clients for pending check-ins (24h and 48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        // Check if Sunday has passed (IST)
        const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const dayOfWeek = istNow.getDay();

        // Nudge on Monday (24h) and Tuesday (48h)
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          await sendWhatsApp({
            phone: client.phone,
            templateName: 'checkin_nudge',
            params: [client.name || 'Champion', checkinUrl],
            bypassRateLimit: true
          });
          checkinNudges++;
        }

        // 2 consecutive missed check-ins → escalate
        if (weekNo >= 2) {
          const { data: prevCheckin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weekNo - 1)
            .single();

          if (!prevCheckin && dayOfWeek >= 3) {
            const { escalateToMaddy } = require('../../lib/escalation');
            await escalateToMaddy({
              reason: '2 consecutive missed check-ins',
              phone: client.phone,
              context: `Client: ${client.name}, Program: ${client.program}, Week: ${weekNo}`
            });
          }
        }
      }
    }

    return res.json({ ok: true, droppedNudged: nudged, checkinNudges });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
