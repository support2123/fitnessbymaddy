import supabase from '../_lib/supabase.js';
import { sendTemplate, canSendMessage } from '../_lib/whatsapp.js';
import { maskPhone } from '../_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return res.status(200).json({ message: 'No leads to nudge', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const allowed = await canSendMessage(lead.phone);
      if (!allowed) continue;

      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .eq('template_name', 'win_back');

      if (count && count > 0) continue;

      await sendTemplate(lead.phone, 'win_back', [
        lead.name || 'there',
      ]);

      nudged++;
      console.log(`Win-back nudge: ${maskPhone(lead.phone)}`);
    }

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    const { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;

    for (const client of (pendingCheckins || [])) {
      const startDate = new Date(client.program_started_at);
      const currentWeek = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

      const { data: thisWeekCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (!thisWeekCheckin) {
        const allowed = await canSendMessage(client.phone);
        if (!allowed) continue;

        const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
        await sendTemplate(client.phone, 'checkin_reminder', [
          client.name || 'there',
          checkinUrl,
        ]);
        checkinNudged++;
      }
    }

    console.log(`Nudge cron: win_back=${nudged}, checkin_reminders=${checkinNudged}`);
    return res.status(200).json({ nudged, checkinNudged });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
