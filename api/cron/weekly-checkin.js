import supabase from '../_lib/supabase.js';
import { sendTemplate } from '../_lib/whatsapp.js';
import { maskPhone, weeksBetween } from '../_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = weeksBetween(startDate, new Date());

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastWeek = lastCheckin?.week_no || 0;

      if (lastWeek >= 2 && lastWeek < weekNo - 1) {
        const missedConsecutive = weekNo - 1 - lastWeek;
        if (missedConsecutive >= 2) {
          await sendTemplate(process.env.MADDY_PHONE || client.phone, 'escalation_alert', [
            maskPhone(client.phone),
            `${missedConsecutive} consecutive check-ins missed`,
          ]);
          escalated++;
        }
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      sent++;
    }

    console.log(`Weekly check-in cron: sent=${sent}, escalated=${escalated}`);
    return res.status(200).json({ sent, escalated });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
