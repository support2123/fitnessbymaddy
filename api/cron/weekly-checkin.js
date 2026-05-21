import supabase from '../../lib/supabase.js';
import { sendTemplate, sendText, notifyMaddy } from '../../lib/whatsapp.js';
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
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const missedConsecutive = lastCheckin
        ? weekNo - lastCheckin.week_no - 1
        : weekNo - 1;

      if (missedConsecutive >= 2) {
        await notifyMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name} (${client.phone})\nProgram: ${client.program}\nMissed weeks: ${missedConsecutive}`
        );
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      if (hinglish) {
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ], true);
      } else {
        await sendTemplate(client.phone, 'weekly_checkin_en', [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ], true);
      }

      sent++;

      const { data: previousPending } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo - 1)
        .single();

      if (!previousPending && weekNo > 1) {
        nudged++;
      }
    }

    return res.status(200).json({ ok: true, sent, nudged, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
