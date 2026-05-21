import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../../lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const { data: newLeadsToNudge } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoDaysAgo.toISOString())
      .gt('created_at', sevenDaysAgo.toISOString());

    let nudgedNew = 0;
    for (const lead of (newLeadsToNudge || [])) {
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('sent_at')
        .eq('phone', lead.phone)
        .eq('direction', 'out')
        .gt('sent_at', twoDaysAgo.toISOString())
        .limit(1)
        .single();

      if (recentMsg) continue;

      const market = detectMarket(lead.phone);
      if (isHinglish(market)) {
        await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      } else {
        await sendTemplate(lead.phone, 'nudge_trial_en', [lead.name || 'there']);
      }
      nudgedNew++;
    }

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { data: staleLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo.toISOString())
      .is('last_msg_at', null);

    let dropped = 0;
    for (const lead of (staleLeads || [])) {
      const { data: anyReply } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', lead.phone)
        .eq('direction', 'in')
        .limit(1)
        .single();

      if (anyReply) continue;

      await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
      dropped++;
    }

    const { data: checkinNudges } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    let checkinNudged = 0;
    for (const client of (checkinNudges || [])) {
      const startDate = new Date(client.program_started_at);
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      const { data: checkin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (checkin) continue;

      const dayOfWeek = now.getDay();
      // Nudge on Monday (+1 day after Sunday send) and Tuesday (+2 days)
      if (dayOfWeek === 1 || dayOfWeek === 2) {
        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        if (isHinglish(market)) {
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ], true);
        } else {
          await sendTemplate(client.phone, 'checkin_reminder_en', [
            client.name || 'there',
            String(weekNo),
            checkinUrl,
          ], true);
        }
        checkinNudged++;
      }
    }

    return res.status(200).json({
      ok: true,
      nudged_new: nudgedNew,
      dropped,
      checkin_nudged: checkinNudged,
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
