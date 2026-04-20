import { supabase } from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { isHinglish } from '../../lib/market.js';
import { maskPhone } from '../../lib/mask.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('last_msg_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (error) {
      console.error('Failed to fetch dropped leads:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    let nudged = 0;

    for (const lead of droppedLeads || []) {
      const hinglish = isHinglish(lead.market);

      const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        trialUrl,
      ]);

      nudged++;
      console.log(`Nudge sent: ${maskPhone(lead.phone)}`);
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: newLeadsNoReply } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lte('created_at', twoHoursAgo)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    let followedUp = 0;

    for (const lead of newLeadsNoReply || []) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'in');

      if (count <= 1) {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          'https://fitnessbymaddy.com/program-trial.html',
        ]);
        followedUp++;
      }
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lte('last_msg_at', oneDayAgo);

    if (staleLeads?.length) {
      const ids = staleLeads.map((l) => l.id);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .in('id', ids);
    }

    const { data: activeClients } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('status', 'active');

    let escalatedMissed = 0;

    for (const client of activeClients || []) {
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (!recentCheckins || recentCheckins.length === 0) continue;

      const weekNos = recentCheckins.map((c) => c.week_no);
      const maxWeek = Math.max(...weekNos);

      if (maxWeek >= 3) {
        const hasPrev = weekNos.includes(maxWeek - 1);
        const hasPrevPrev = weekNos.includes(maxWeek - 2);
        if (!hasPrev && !hasPrevPrev) {
          const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
          await sendTemplate(MADDY_PHONE, 'escalation_alert', [
            client.name || 'Client',
            maskPhone(client.phone),
            '2 consecutive missed check-ins',
          ]);
          escalatedMissed++;
        }
      }
    }

    console.log(`Nudge cron: ${nudged} nudged, ${followedUp} followed-up, ${staleLeads?.length || 0} dropped, ${escalatedMissed} escalated`);
    return res.status(200).json({
      status: 'done',
      nudged,
      followed_up: followedUp,
      newly_dropped: staleLeads?.length || 0,
      escalated_missed: escalatedMissed,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
