import { getSupabase } from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { escalateToMaddy } from '../_lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return res.json({ ok: true, message: 'No active clients' });
  }

  const results = [];

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const weekNo = Math.ceil(daysSinceStart / 7);

    if (weekNo < 1) continue;

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .limit(1);

    if (existingCheckin && existingCheckin.length > 0) continue;

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(3);

    const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
    const missedCount = weekNo - lastCheckedWeek - 1;

    if (missedCount >= 2) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        client.phone,
        `Client ${client.name} has missed ${missedCount} check-ins (current week: ${weekNo})`
      );
    }

    const checkinLink = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', [
      client.name || 'there',
      String(weekNo),
      checkinLink
    ]);

    results.push({ client_id: client.id, week_no: weekNo });
  }

  return res.json({ ok: true, sent: results.length, details: results });
}
