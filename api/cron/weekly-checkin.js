import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = [];

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.floor(daysSinceStart / 7) + 1;

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await supabase.from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        results.push({ client_id: client.id, action: 'completed' });
        continue;
      }

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) {
        results.push({ client_id: client.id, action: 'already_submitted' });
        continue;
      }

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(
        client.phone,
        'weekly_checkin',
        [client.name || 'there', String(currentWeek), checkinUrl],
        client.name
      );

      // Log the nudge
      await supabase.from('nudge_log').insert({
        phone: client.phone,
        nudge_type: `checkin_week_${currentWeek}`,
      });

      results.push({ client_id: client.id, action: 'sent', week: currentWeek });
    }

    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
