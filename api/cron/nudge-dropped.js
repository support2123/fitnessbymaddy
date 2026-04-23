import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { isHinglish } from '../lib/utils.js';

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Find leads that went silent (new status, last message > 24h ago, created < 7 days ago)
    const { data: stalledLeads } = await supabase
      .from('leads')
      .select('*')
      .in('status', ['new', 'qualified'])
      .lt('last_msg_at', oneDayAgo.toISOString())
      .gt('created_at', sevenDaysAgo.toISOString());

    if (!stalledLeads || stalledLeads.length === 0) {
      return res.status(200).json({ ok: true, message: 'No leads to nudge' });
    }

    const results = [];

    for (const lead of stalledLeads) {
      // Check if we already nudged today
      const { data: recentNudge } = await supabase
        .from('nudge_log')
        .select('id')
        .eq('phone', lead.phone)
        .eq('nudge_type', 'lead_reengagement')
        .gt('sent_at', oneDayAgo.toISOString())
        .limit(1);

      if (recentNudge && recentNudge.length > 0) {
        results.push({ phone: lead.phone, action: 'already_nudged' });
        continue;
      }

      // Count total nudges for this lead
      const { count } = await supabase
        .from('nudge_log')
        .select('id', { count: 'exact' })
        .eq('phone', lead.phone)
        .eq('nudge_type', 'lead_reengagement');

      // Max 3 re-engagement nudges
      if (count >= 3) {
        await supabase.from('leads')
          .update({ status: 'dropped' })
          .eq('id', lead.id);
        results.push({ phone: lead.phone, action: 'dropped_max_nudges' });
        continue;
      }

      // Send nudge
      await sendTemplate(
        lead.phone,
        'nudge_trial',
        [lead.name || 'there'],
        lead.name
      );

      await supabase.from('nudge_log').insert({
        phone: lead.phone,
        nudge_type: 'lead_reengagement',
      });

      results.push({ phone: lead.phone, action: 'nudged' });
    }

    // Also nudge clients who haven't submitted weekly check-ins
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    for (const client of (activeClients || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!checkin) {
        // Check how many days since Sunday (last check-in request)
        const dayOfWeek = now.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 3) {
          // Mon-Wed: check if we already nudged
          const { data: nudged } = await supabase
            .from('nudge_log')
            .select('id')
            .eq('phone', client.phone)
            .eq('nudge_type', `checkin_nudge_week_${currentWeek}`)
            .gt('sent_at', oneDayAgo.toISOString())
            .limit(1);

          if (!nudged || nudged.length === 0) {
            const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
            const msg = isHinglish(client.market || 'GLOBAL')
              ? `Hey ${client.name || 'there'}! Weekly check-in abhi tak nahi hua. 5 min lagega bas: ${checkinUrl}`
              : `Hey ${client.name || 'there'}! Your weekly check-in is still pending. Takes just 5 min: ${checkinUrl}`;

            await sendTemplate(
              client.phone,
              'checkin_reminder',
              [client.name || 'there', String(currentWeek), checkinUrl],
              client.name
            );

            await supabase.from('nudge_log').insert({
              phone: client.phone,
              nudge_type: `checkin_nudge_week_${currentWeek}`,
            });

            // 2 consecutive missed check-ins → escalate
            const { data: prevCheckin } = await supabase
              .from('checkins')
              .select('id')
              .eq('client_id', client.id)
              .eq('week_no', currentWeek - 1)
              .single();

            if (!prevCheckin && currentWeek > 1) {
              await supabase.from('escalations').insert({
                phone: client.phone,
                client_id: client.id,
                trigger: 'missed_checkins',
                message: `2 consecutive missed check-ins (weeks ${currentWeek - 1} and ${currentWeek})`,
              });
            }
          }
        }
      }
    }

    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
