const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendToLead } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Flow A step 3: Leads with no reply after 2 hours — send trial nudge
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo.toISOString())
      .is('program_interest', null);

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        // Only nudge if we haven't already sent a nudge (check messages)
        const { data: nudgeMessages } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .limit(1);

        if (nudgeMessages && nudgeMessages.length > 0) continue;

        if (await canSendToLead(lead.phone)) {
          const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
          await sendTemplate(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            trialUrl
          ]);
          nudged++;
        }
      }
    }

    // Flow A step 4: Leads with no reply after 24 hours — drop
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo.toISOString());

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule): leads dropped 7+ days ago, not yet re-engaged
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const { data: reengageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo.toISOString())
      .gt('last_msg_at', eightDaysAgo.toISOString());

    let reengaged = 0;
    if (reengageLeads) {
      for (const lead of reengageLeads) {
        const { data: reengageMsg } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_7day')
          .limit(1);

        if (reengageMsg && reengageMsg.length > 0) continue;

        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reengaged++;
      }
    }

    // Nudge active clients who haven't submitted weekly check-in (24hr and 48hr)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    if (activeClients) {
      for (const client of activeClients) {
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

        // Check day of week (Sunday = check-in day, Mon = +24hr, Tue = +48hr)
        const dayOfWeek = now.getDay();
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          if (await canSendToLead(client.phone)) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
            await sendTemplate(client.phone, 'checkin_reminder', [
              client.name || 'there',
              String(currentWeek),
              checkinUrl
            ]);
            clientNudged++;
          }
        }
      }
    }

    return res.status(200).json({ nudged, dropped, reengaged, clientNudged });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
