const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const now = new Date();

    // Nudge leads with no reply after 2 hours (status=new, created > 2hrs ago)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2-hour nudge for new leads
    const { data: newLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;

    if (newLeads) {
      for (const lead of newLeads) {
        const { data: msgs } = await db
          .from('messages')
          .select('template_name')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length === 0) {
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            'https://fitnessbymaddy.com/intake?lead=' + lead.id,
          ]);
          nudged++;
        }
      }
    }

    // 24-hour drop for unresponsive leads
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo)
      .gt('created_at', sevenDaysAgo);

    let dropped = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time)
    const { data: droppedLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reengaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengage } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day');

        if (!reengage || reengage.length === 0) {
          await sendWhatsApp(lead.phone, 'reengage_7day', [lead.name || 'there']);
          reengaged++;
        }
      }
    }

    // Check for clients with 2 consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalated = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

        if (weekNo < 3) continue;

        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2);

        if (!recentCheckins || recentCheckins.length === 0) {
          const { sendWhatsApp: sendWA } = require('../lib/whatsapp');
          await sendWA('+917082478374', 'escalation_alert', [
            '2 consecutive missed check-ins',
            client.phone,
            `Client: ${client.name}, Week ${weekNo}`,
          ]);
          escalated++;
        }
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, reengaged, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
