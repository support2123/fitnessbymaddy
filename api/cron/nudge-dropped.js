const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await db
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    for (const lead of staleLeads || []) {
      const { data: msgs } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', lead.created_at)
        .limit(2);

      if (msgs && msgs.length >= 2) continue;

      const market = lead.market || 'IN';
      const msg = market === 'IN'
        ? `Hey! 👋 Ek quick trial session try karna chahoge? Sirf $20 mein Maddy ke saath live Zoom session.\n\n👉 https://fitnessbymaddy.com/program-trial.html\n\nNo commitment — bas dekho ki coaching kaisi hoti hai!`
        : `Hey! 👋 Want to try a quick trial session? Just $20 for a live Zoom session with Maddy.\n\n👉 https://fitnessbymaddy.com/program-trial.html\n\nNo commitment — just see what coaching is like!`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'nudge_trial',
        templateParams: { name: lead.name || 'there', params: [lead.name || 'there'] },
      });
      nudged++;
    }

    // Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await db
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of deadLeads || []) {
      const { data: replies } = await db
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', oneDayAgo)
        .limit(1);

      if (!replies || replies.length === 0) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;
    for (const client of activeClients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const currentWeek = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24 * 7));

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2)
        .lte('week_no', currentWeek);

      if (!recentCheckins || recentCheckins.length === 0) {
        await db.from('escalations').insert({
          phone: client.phone,
          reason: '2+ consecutive missed check-ins',
          message_body: `Client ${client.name || client.phone} has missed weeks ${currentWeek - 1} and ${currentWeek}`,
        });
        await notifyMaddy(
          '2 missed check-ins',
          `Client: ${client.name || 'Unknown'} — missed weeks ${currentWeek - 1} & ${currentWeek}`
        );
        escalated++;
      }
    }

    return res.status(200).json({ success: true, nudged, dropped, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
