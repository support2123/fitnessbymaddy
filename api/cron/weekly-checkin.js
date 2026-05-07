import { supabase } from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { logMessage } from '../lib/rate-limit.js';
import { escalateToMaddy } from '../lib/escalation.js';

export const config = { cron: '30 3 * * 0' }; // Sunday 9:00 AM IST (3:30 UTC)

export default async function handler(req, res) {
  try {
    const { data: clients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ status: 'no_active_clients' });
    }

    const results = [];

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2)
        .lte('week_no', weekNo - 1);

      if (missedCount === 0 && weekNo > 2) {
        await escalateToMaddy(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name} (${client.program}) hasn't checked in for 2 weeks`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);
      await logMessage(client.phone, 'out', `Week ${weekNo} check-in form`, 'weekly_checkin');

      results.push({ client_id: client.id, week_no: weekNo, status: 'sent' });
    }

    return res.status(200).json({ status: 'done', results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
