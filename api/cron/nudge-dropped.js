const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Re-engage leads that went silent 2+ hours ago (new leads only)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge new leads with no reply after 2 hours
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', oneDayAgo);

    let nudged = 0;

    for (const lead of silentLeads || []) {
      const { data: outbound } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'nudge_trial')
        .limit(1);

      if (outbound && outbound.length > 0) continue;

      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial_en';

      await sendTemplate(lead.phone, templateName, [
        lead.name || 'there',
        'https://fitnessbymaddy.com/program-trial.html',
      ]);
      nudged++;
    }

    // Mark leads as dropped if no reply after 24 hours
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    for (const lead of staleLeads || []) {
      await supabase.from('leads')
        .update({ status: 'dropped' })
        .eq('id', lead.id);
      dropped++;
    }

    // Nudge dropped leads after 7 days (one-time re-engagement)
    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo);

    let reEngaged = 0;

    for (const lead of reEngageLeads || []) {
      const { data: reEngageMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'reengage_7day')
        .limit(1);

      if (reEngageMsg && reEngageMsg.length > 0) continue;

      const market = detectMarket(lead.phone);
      const templateName = isHinglish(market) ? 'reengage_7day_hi' : 'reengage_7day_en';

      await sendTemplate(lead.phone, templateName, [lead.name || 'there']);
      reEngaged++;
    }

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let escalated = 0;

    for (const client of activeClients || []) {
      const currentWeek = calculateWeekNo(client.program_started_at);
      if (currentWeek < 3) continue;

      const { data: checkins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const submittedWeeks = (checkins || []).map(c => c.week_no);
      const missedConsecutive =
        !submittedWeeks.includes(currentWeek - 1) &&
        !submittedWeeks.includes(currentWeek - 2);

      if (missedConsecutive) {
        const { sendToMaddy } = require('../lib/whatsapp');
        await sendToMaddy(
          `MISSED CHECK-INS: ${client.name} (${client.phone}) missed weeks ${currentWeek - 2} and ${currentWeek - 1}`
        );
        escalated++;
      }
    }

    return res.json({
      success: true,
      nudged,
      dropped,
      reEngaged,
      escalated,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}
