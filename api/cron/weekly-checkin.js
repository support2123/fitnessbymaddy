import supabase from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { escalateToMaddy } from '../../lib/escalation.js';
import { weeksBetween, maskPhone } from '../../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'] || '';
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients').select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = weeksBetween(client.program_started_at, new Date());

      const { data: existing } = await supabase
        .from('checkins').select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { count: missedCount } = await supabase
        .from('checkins').select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', weekNo - 2);

      const expectedCheckins = Math.min(weekNo, 2);
      const actualCheckins = missedCount || 0;

      if (weekNo >= 3 && actualCheckins === 0) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          details: `Client has missed check-ins for weeks ${weekNo - 1} and ${weekNo}`
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl
      ]);

      sent++;
    }

    console.log(`Weekly check-in cron: sent=${sent}, escalated=${escalated}`);
    return res.json({ ok: true, sent, escalated });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
