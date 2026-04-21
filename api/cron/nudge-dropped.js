const { supabase } = require('../_lib/supabase');
const { sendTemplate, detectMarket } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let nudged = 0;
    let dropped = 0;

    // PART 1: Nudge new leads who haven't replied (2-hour window passed)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stalledLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .eq('opted_out', false)
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    for (const lead of (stalledLeads || [])) {
      // Check if we already sent a nudge
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial');

      if (count > 0) continue;

      const market = lead.market || detectMarket(lead.phone);
      const template = market === 'IN' ? 'nudge_trial_hindi' : 'nudge_trial';
      const trialUrl = `${process.env.APP_URL || 'https://fitnessbymaddy.com'}/program-trial.html`;

      await sendTemplate(lead.phone, template, [lead.name || 'there', trialUrl]);
      nudged++;
    }

    // PART 2: Drop leads who are 24+ hours old with no reply
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    for (const lead of (expiredLeads || [])) {
      // Check if they replied (any inbound message after the lead was created)
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .gt('sent_at', lead.created_at);

      if ((count || 0) <= 1) {
        // Only their initial message — drop them
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // PART 3: Nudge active clients who haven't submitted weekly check-in (24h + 48h)
    let clientNudges = 0;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const weekNo = calculateCurrentWeek(client.program_started_at);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      // Check how many nudges we already sent this week
      const weekStart = getWeekStart();
      const { count: nudgeCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', client.phone)
        .eq('direction', 'out')
        .eq('template_name', 'checkin_nudge')
        .gte('sent_at', weekStart);

      if ((nudgeCount || 0) < 2) {
        const checkinUrl = `${process.env.APP_URL || 'https://fitnessbymaddy.com'}/checkin?c=${client.id}&w=${weekNo}`;
        await sendTemplate(client.phone, 'checkin_nudge', [client.name || 'there', checkinUrl]);
        clientNudges++;
      }
    }

    // PART 4: Re-engage dropped leads (7-day rule — one last attempt)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .eq('opted_out', false)
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reEngaged = 0;
    for (const lead of (reEngageLeads || [])) {
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day');

      if ((count || 0) === 0) {
        await sendTemplate(lead.phone, 'reengage_7day', [lead.name || 'there']);
        reEngaged++;
      }
    }

    return res.status(200).json({
      success: true,
      nudged,
      dropped,
      client_nudges: clientNudges,
      reengaged: reEngaged
    });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateCurrentWeek(startDate) {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now - start;
  return Math.max(1, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1);
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day;
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString();
}
