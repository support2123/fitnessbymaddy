const { supabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit, notifyMaddy } = require('../_lib/whatsapp');
const { weeksBetween } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const now = new Date();

    // Nudge leads that went silent (2hr and 24hr rules from Flow A)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Find new leads that haven't replied in 2+ hours (send trial nudge)
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('last_msg_at', twoHoursAgo)
      .gt('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;
    if (silentLeads) {
      for (const lead of silentLeads) {
        const limited = await checkRateLimit(lead.phone);
        if (limited) continue;

        await sendTemplate(lead.phone, 'nudge_trial', {
          name: lead.name || 'there',
          templateParams: [
            lead.name || 'there',
            'https://fitnessbymaddy.com/program-trial.html',
          ],
        });
        nudged++;
      }
    }

    // Drop leads silent for 24+ hours
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;
    if (deadLeads && deadLeads.length > 0) {
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .eq('status', 'new')
        .lt('last_msg_at', twentyFourHoursAgo);
      dropped = deadLeads.length;
    }

    // Nudge active clients with missed check-ins (48hr rule)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let clientNudged = 0;
    let escalated = 0;

    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = weeksBetween(client.program_started_at, now.toISOString()) + 1;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1)
          .single();

        if (checkin) continue;

        // Check how many consecutive weeks missed
        const { data: lastCheckin } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .single();

        const missedWeeks = lastCheckin ? weekNo - lastCheckin.week_no : weekNo;

        if (missedWeeks >= 2) {
          await notifyMaddy(
            '2 Missed Check-ins',
            `${client.name || client.phone} has missed ${missedWeeks} consecutive check-ins.`
          );
          escalated++;
          continue;
        }

        const limited = await checkRateLimit(client.phone);
        if (limited) continue;

        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', {
          name: client.name || 'there',
          templateParams: [client.name || 'there', formUrl],
        });
        clientNudged++;
      }
    }

    return res.status(200).json({
      ok: true,
      leads_nudged: nudged,
      leads_dropped: dropped,
      clients_nudged: clientNudged,
      escalated,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
