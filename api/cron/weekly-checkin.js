import { getSupabase } from '../_lib/supabase.js';
import { sendTemplate, maskPhone } from '../_lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients?.length) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    let sent = 0;
    let errors = 0;

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.max(1, Math.ceil(daysSinceStart / 7));

        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existing) continue;

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl
        ]);

        sent++;
        console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
      } catch (err) {
        errors++;
        console.error(`Check-in send failed for ${maskPhone(client.phone)}:`, err.message);
      }
    }

    return res.status(200).json({ ok: true, sent, errors, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
