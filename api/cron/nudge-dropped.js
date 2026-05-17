const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge leads that haven't replied after 2 hours (new leads only)
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lt('created_at', twoHoursAgo)
      .gt('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (msgs && msgs.length > 0) continue;

        await sendWhatsApp(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [lead.name || 'there']
        });
        nudged++;
      }
    }

    // Drop leads older than 24hrs with no reply
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        const { data: inbound } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'in')
          .gt('sent_at', lead.created_at)
          .limit(1);

        if (!inbound || inbound.length === 0) {
          await supabase.from('leads')
            .update({ status: 'dropped' })
            .eq('id', lead.id);
          dropped++;
        }
      }
    }

    // Nudge active clients with pending check-ins (48hr reminder)
    const { data: pendingClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    if (pendingClients) {
      for (const client of pendingClients) {
        if (!client.program_started_at) continue;
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        if (dayOfWeek === 2 || dayOfWeek === 3) {
          await sendWhatsApp(client.phone, 'checkin_reminder', {
            name: client.name || 'there',
            templateParams: [
              client.name || 'there',
              `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`
            ]
          });
          clientNudged++;
        }
      }
    }

    // Escalate 2 consecutive missed check-ins
    if (pendingClients) {
      for (const client of pendingClients) {
        if (!client.program_started_at) continue;
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 3) continue;

        const { data: lastTwo } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', currentWeek - 2)
          .lte('week_no', currentWeek - 1);

        if (!lastTwo || lastTwo.length === 0) {
          const { escalate } = require('../lib/escalation');
          await escalate(client.phone, '2_missed_checkins', `Client missed weeks ${currentWeek - 2} and ${currentWeek - 1}`, client.id);
        }
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      client_nudged: clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
