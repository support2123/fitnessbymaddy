const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // --- PART 1: Nudge new leads that haven't replied (2-hour mark) ---
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString();

    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', fourHoursAgo);

    let nudged = 0;
    for (const lead of (staleNewLeads || [])) {
      const market = lead.market || detectMarket(lead.phone);
      const template = market === 'IN' ? 'nudge_trial_hindi' : 'nudge_trial';
      const result = await sendTemplate(lead.phone, template, [lead.name || 'there']);
      if (result.success) nudged++;
    }

    // --- PART 2: Drop leads with no reply after 24 hours ---
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    if (expiredLeads && expiredLeads.length > 0) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', expiredLeads.map(l => l.id));
    }

    // --- PART 3: Nudge clients who missed check-in (+24hr, +48hr) ---
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let clientNudges = 0;
    let escalations = 0;

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (checkin && checkin.length > 0) continue;

      // Check how many consecutive weeks missed
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckedWeek = recentCheckins?.[0]?.week_no || 0;
      const missedWeeks = weekNo - lastCheckedWeek;

      if (missedWeeks >= 2) {
        // 2 consecutive missed — escalate to Maddy
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          details: `${client.name || 'Client'} missed weeks ${weekNo - 1} and ${weekNo}`
        });
        escalations++;
      } else {
        // Send nudge
        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          formUrl
        ]);
        clientNudges++;
      }
    }

    // --- PART 4: Re-engage dropped leads (7-day rule) ---
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'dropped')
      .gt('last_msg_at', eightDaysAgo)
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const market = lead.market || detectMarket(lead.phone);
      const template = market === 'IN' ? 'reengage_hindi' : 'reengage';
      const result = await sendTemplate(lead.phone, template, [lead.name || 'there']);
      if (result.success) reEngaged++;
    }

    return res.status(200).json({
      nudged_new_leads: nudged,
      dropped_expired: expiredLeads?.length || 0,
      client_nudges: clientNudges,
      escalations,
      re_engaged: reEngaged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
