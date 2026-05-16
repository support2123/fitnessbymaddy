const { supabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who haven't replied in 2 hours (new leads only)
    const { data: staleNew } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudgedCount = 0;

    if (staleNew) {
      for (const lead of staleNew) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('template_name')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length > 0) continue;

        const msg = lead.market === 'IN'
          ? 'Hey! 👋 Agar confuse ho toh ek $20 trial session try karo — Maddy ke saath live Zoom pe. Zero risk, full clarity.\n\nhttps://www.fitnessbymaddy.com/program-trial.html'
          : 'Hey! 👋 Not sure where to start? Try a $20 trial session — live on Zoom with Maddy. Zero risk, full clarity.\n\nhttps://www.fitnessbymaddy.com/program-trial.html';

        await sendWhatsApp({
          phone: lead.phone,
          templateName: 'nudge_trial',
          params: [msg],
        });
        nudgedCount++;
      }
    }

    // Drop leads with no reply in 24 hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let droppedCount = 0;
    if (deadLeads && deadLeads.length > 0) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', deadLeads.map(l => l.id));
      droppedCount = deadLeads.length;
    }

    // Nudge active clients who missed check-ins (24h and 48h reminders)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;
    let consecutiveMisses = [];

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

        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo - 1)
          .single();

        if (!prevCheckin && weekNo > 1) {
          consecutiveMisses.push(client);
          continue;
        }

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        await sendWhatsApp({
          phone: client.phone,
          templateName: 'checkin_reminder',
          params: [`Reminder: Your Week ${weekNo} check-in is pending! ${checkinUrl}`],
        });
        clientNudges++;
      }
    }

    if (consecutiveMisses.length > 0) {
      const names = consecutiveMisses.map(c => c.name || 'Unknown').join(', ');
      await notifyMaddy(`2+ missed check-ins: ${names} (${consecutiveMisses.length} clients)`);
    }

    return res.status(200).json({
      nudged: nudgedCount,
      dropped: droppedCount,
      client_nudges: clientNudges,
      escalated_misses: consecutiveMisses.length,
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
