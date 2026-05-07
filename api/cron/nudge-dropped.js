import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Nudge leads who haven't replied in 2 hours (Flow A, step 3)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: staleLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('last_msg_at', twoHoursAgo)
      .gte('last_msg_at', twentyFourHoursAgo);

    let nudged = 0;

    if (staleLeads) {
      for (const lead of staleLeads) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial');

        if (count && count > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'nudge_trial' : 'nudge_trial_en';

        await sendTemplate(lead.phone, templateName, [
          'https://fitnessbymaddy.com/program-trial.html'
        ]);
        nudged++;
      }
    }

    // Drop leads with no reply after 24 hours
    const { data: expiredLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', twentyFourHoursAgo);

    let dropped = 0;

    if (expiredLeads) {
      for (const lead of expiredLeads) {
        await supabase
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        dropped++;
      }
    }

    // Re-engage dropped leads (7-day rule) — send one re-engagement message
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const { data: reEngageLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .lte('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);

    let reengaged = 0;

    if (reEngageLeads) {
      for (const lead of reEngageLeads) {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'reengage_7day');

        if (count && count > 0) continue;

        const market = detectMarket(lead.phone);
        const templateName = isHinglish(market) ? 'reengage_7day' : 'reengage_7day_en';

        await sendTemplate(lead.phone, templateName, [
          lead.name || 'there'
        ]);
        reengaged++;
      }
    }

    // Nudge clients who haven't submitted check-ins
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudged = 0;

    if (activeClients) {
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=Sun

      if (dayOfWeek === 1 || dayOfWeek === 2) {
        for (const client of activeClients) {
          const weeksElapsed = Math.ceil(
            (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
          );

          const { data: checkin } = await supabase
            .from('checkins')
            .select('id')
            .eq('client_id', client.id)
            .eq('week_no', weeksElapsed)
            .single();

          if (!checkin) {
            const market = detectMarket(client.phone);
            const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;
            const templateName = isHinglish(market) ? 'checkin_reminder' : 'checkin_reminder_en';

            await sendTemplate(client.phone, templateName, [
              client.name || 'there',
              checkinUrl
            ]);
            checkinNudged++;
          }
        }
      }
    }

    return res.status(200).json({
      nudged,
      dropped,
      reengaged,
      checkin_nudged: checkinNudged
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
