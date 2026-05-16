const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !req.headers['x-vercel-cron']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Nudge leads who went silent (2hr no-reply → trial nudge)
    const { data: silentLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market, created_at')
      .eq('status', 'new')
      .lt('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .gt('created_at', twoDaysAgo);

    let nudged = 0;
    for (const lead of (silentLeads || [])) {
      const market = lead.market || detectMarket(lead.phone);
      const template = market === 'IN' ? 'nudge_trial_hindi' : 'nudge_trial';

      const result = await sendWhatsApp(lead.phone, template, {
        name: lead.name || 'there',
        templateParams: [lead.name || 'there', 'https://fitnessbymaddy.com/program-trial.html']
      });

      if (result.success) nudged++;
    }

    // Mark 24hr-silent leads as dropped
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    // Check for clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, name, phone, program_started_at')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (currentWeek < 3) continue;

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      if (!recentCheckins || recentCheckins.length === 0) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          name: client.name,
          phone: client.phone,
          details: `No check-ins for weeks ${currentWeek - 1} and ${currentWeek}`
        });
      }
    }

    // Nudge clients who haven't submitted this week's checkin (+24hr, +48hr)
    const { data: pendingNudges } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let clientNudged = 0;
    for (const client of (pendingNudges || [])) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      const { data: thisWeekCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (!thisWeekCheckin || thisWeekCheckin.length === 0) {
        const dayOfWeek = new Date().getDay();
        // Nudge on Monday (day after Sunday send) and Tuesday
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
          await sendWhatsApp(client.phone, 'checkin_nudge', {
            name: client.name || 'there',
            templateParams: [client.name || 'there', checkinUrl]
          }, true);
          clientNudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      leads_nudged: nudged,
      clients_nudged: clientNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
