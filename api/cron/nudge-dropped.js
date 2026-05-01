const supabase = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { maskPhone } = require('../../lib/phone');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Re-engage leads dropped within last 7 days who haven't been nudged yet
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('dropped_at', sevenDaysAgo)
      .lt('nudge_count', 1);

    let reEngaged = 0;

    if (droppedLeads) {
      for (const lead of droppedLeads) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there'
        ]);

        await supabase.from('leads').update({
          nudge_count: (lead.nudge_count || 0) + 1
        }).eq('id', lead.id);

        reEngaged++;
        console.log(`Re-engaged dropped lead: ${maskPhone(lead.phone)}`);
      }
    }

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .lt('nudge_count', 1);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there'
        ]);

        await supabase.from('leads').update({
          nudge_count: (lead.nudge_count || 0) + 1
        }).eq('id', lead.id);

        nudged++;
      }
    }

    // Mark leads as dropped if no reply in 24 hours after nudge
    const { data: noReplyLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('nudge_count', 1)
      .lt('last_msg_at', oneDayAgo);

    let dropped = 0;

    if (noReplyLeads) {
      for (const lead of noReplyLeads) {
        await supabase.from('leads').update({
          status: 'dropped',
          dropped_at: new Date().toISOString()
        }).eq('id', lead.id);

        dropped++;
      }
    }

    // Nudge active clients with pending check-ins (24hr and 48hr reminders)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudges = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (checkin) continue;

        const { data: lastMsg } = await supabase
          .from('messages')
          .select('sent_at')
          .eq('phone', client.phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastMsg) continue;

        const hoursSinceLastMsg = (Date.now() - new Date(lastMsg.sent_at).getTime()) / (60 * 60 * 1000);

        if (hoursSinceLastMsg >= 24 && hoursSinceLastMsg < 72) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]);
          clientNudges++;
        }
      }
    }

    return res.status(200).json({
      ok: true,
      re_engaged: reEngaged,
      nudged,
      dropped,
      client_nudges: clientNudges
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
