const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.headers['x-api-key'] !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();
  const now = new Date();

  // Nudge leads that went silent 2hrs ago (no reply after welcome)
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: silentLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twoHoursAgo)
    .gte('created_at', twentyFourHoursAgo);

  let nudged = 0;
  let dropped = 0;

  if (silentLeads) {
    for (const lead of silentLeads) {
      const hoursSinceCreated = (now - new Date(lead.created_at)) / (1000 * 60 * 60);

      if (hoursSinceCreated >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      } else if (hoursSinceCreated >= 2) {
        const { data: alreadyNudged } = await db
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'nudge_trial')
          .single();

        if (!alreadyNudged) {
          const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
          await sendWhatsApp(lead.phone, 'nudge_trial', [
            lead.name || 'there',
            trialUrl
          ]);
          nudged++;
        }
      }
    }
  }

  // Drop leads older than 24hrs with no reply
  const { data: oldLeads } = await db
    .from('leads')
    .select('*')
    .eq('status', 'new')
    .lte('created_at', twentyFourHoursAgo);

  if (oldLeads) {
    for (const lead of oldLeads) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }
  }

  // Nudge active clients with missing check-ins (24hr and 48hr)
  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  let clientNudges = 0;
  let escalations = 0;

  if (activeClients) {
    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysDiff / 7);
      const dayInWeek = daysDiff % 7;

      if (dayInWeek < 1) continue;

      const { data: checkin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      if (dayInWeek >= 1 && dayInWeek < 3) {
        await sendWhatsApp(client.phone, 'checkin_reminder', [
          client.name || 'there',
          String(weekNo)
        ]);
        clientNudges++;
      }

      // Check for 2 consecutive missed check-ins → escalate
      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      if (lastTwo && lastTwo.length > 0) {
        const lastWeek = lastTwo[0].week_no;
        if (weekNo - lastWeek >= 2) {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name} | Last check-in: Week ${lastWeek} | Current: Week ${weekNo}`
          );
          escalations++;
        }
      }
    }
  }

  return res.status(200).json({
    nudged_leads: nudged,
    dropped_leads: dropped,
    client_nudges: clientNudges,
    escalations
  });
};
