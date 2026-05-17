const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const { checkMissedCheckins, escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let nudged = 0;
    let escalated = 0;

    // Nudge new leads who haven't replied (2hr mark)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length > 0) continue;

        const market = detectMarket(lead.phone);
        const msg = market === 'IN'
          ? 'Agar decide nahi ho pa raha toh ek $20 trial session try karo — no commitment! Link: https://fitnessbymaddy.com/trial'
          : 'Not sure yet? Try a $20 trial session — no commitment! Link: https://fitnessbymaddy.com/trial';

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          body: msg,
          params: []
        });

        nudged++;
      }
    }

    // Drop leads older than 24hrs with no reply
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    if (deadLeads) {
      const deadIds = deadLeads.map(l => l.id);
      if (deadIds.length > 0) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .in('id', deadIds);
      }
    }

    // Check for clients with missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    if (activeClients) {
      for (const client of activeClients) {
        const missed = await checkMissedCheckins(client.id);
        if (missed) {
          await escalate({
            phone: client.phone,
            reason: '2_consecutive_missed_checkins',
            messageBody: `Client ${client.name} has missed 2+ consecutive check-ins`
          });
          escalated++;
        }
      }
    }

    // Nudge clients who haven't submitted this week's check-in (+24hr, +48hr)
    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const weekNo = Math.ceil(
          (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (checkin) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);

        const msg = market === 'IN'
          ? `Reminder: Week ${weekNo} check-in abhi tak pending hai. Jaldi fill karo: ${checkinUrl}`
          : `Reminder: Your Week ${weekNo} check-in is still pending. Please fill it: ${checkinUrl}`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_reminder',
          body: msg,
          params: [String(weekNo), checkinUrl]
        });

        nudged++;
      }
    }

    return res.status(200).json({ success: true, nudged, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
