const { supabase } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');
const { maskPhone, isHinglish } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // PART 1: Nudge new leads who haven't replied (2hrs+ since welcome)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gt('created_at', twentyFourHoursAgo);

    let nudged = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (msgs && msgs.length > 0) continue;

        const market = lead.market || 'GLOBAL';
        const templateName = isHinglish(market) ? 'nudge_trial_hi' : 'nudge_trial';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        nudged++;
      }
    }

    // PART 2: Mark 24hr+ non-responders as dropped
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('*')
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
          .limit(2);

        if (inbound && inbound.length <= 1) {
          await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
          dropped++;
        }
      }
    }

    // PART 3: Flag clients with 2+ consecutive missed check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let escalated = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const startDate = new Date(client.program_started_at);
        const currentWeek = Math.ceil((Date.now() - startDate.getTime()) / (7 * 86400000));

        if (currentWeek < 3) continue;

        const { data: checkins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(2);

        const recentWeeks = (checkins || []).map(c => c.week_no);
        const missedLast = !recentWeeks.includes(currentWeek - 1);
        const missedPrev = !recentWeeks.includes(currentWeek - 2);

        if (missedLast && missedPrev) {
          await notifyMaddy(
            '2 missed check-ins',
            `Client: ${maskPhone(client.phone)} (${client.name || 'unknown'})\nProgram: ${client.program}\nWeeks ${currentWeek - 2} and ${currentWeek - 1} missed`
          );
          escalated++;
        }
      }
    }

    console.log(`Nudge cron: nudged=${nudged}, dropped=${dropped}, escalated=${escalated}`);
    return res.status(200).json({ ok: true, nudged, dropped, escalated });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
