import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Nudge new leads who haven't replied in 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Drop leads with no reply in 24h
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'new')
      .lt('created_at', twentyFourHoursAgo);

    let dropped = 0;
    if (staleLeads) {
      for (const lead of staleLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // Send trial nudge to leads who haven't replied in 2h but are < 24h old
    const { data: nudgeLeads } = await supabase
      .from('leads')
      .select('id, phone, name, market')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gte('created_at', twentyFourHoursAgo);

    let nudgedCount = 0;
    if (nudgeLeads) {
      for (const lead of nudgeLeads) {
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('template_name')
          .eq('phone', lead.phone)
          .eq('direction', 'out')
          .eq('template_name', 'nudge_trial')
          .limit(1)
          .single();

        if (lastMsg) continue;

        const trialUrl = 'https://fitnessbymaddy.com/program-trial.html';
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there',
          '$20',
          trialUrl,
        ]);
        nudgedCount++;
      }
    }

    // Re-engage dropped leads after 7 days (one-time re-engagement)
    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString());

    let reengaged = 0;
    if (droppedLeads) {
      for (const lead of droppedLeads) {
        const { data: reengage } = await supabase
          .from('messages')
          .select('id')
          .eq('phone', lead.phone)
          .eq('template_name', 'reengage_dropped')
          .limit(1)
          .single();

        if (reengage) continue;

        await sendTemplate(lead.phone, 'reengage_dropped', [
          lead.name || 'there',
        ]);
        reengaged++;
      }
    }

    // Nudge active clients who haven't submitted check-in
    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let clientNudged = 0;
    if (pendingCheckins) {
      for (const client of pendingCheckins) {
        const startDate = new Date(client.program_started_at);
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);
        if (currentWeek < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', currentWeek)
          .single();

        if (checkin) continue;

        const dayOfWeek = now.getDay();
        // Nudge on Monday (1) and Tuesday (2) after Sunday check-in request
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            `Week ${currentWeek}`,
            checkinUrl,
          ]);
          clientNudged++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      dropped,
      nudged: nudgedCount,
      reengaged,
      client_nudged: clientNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
