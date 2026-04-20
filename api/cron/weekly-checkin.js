import supabase from '../_lib/supabase.js';
import { sendWhatsApp } from '../_lib/whatsapp.js';
import { escalateMissedCheckins } from '../_lib/escalation.js';
import { isHinglish } from '../_lib/market.js';
import { maskPhone } from '../_lib/mask.js';

const BASE_URL = 'https://fitnessbymaddy.com';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
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

    if (!activeClients?.length) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existingCheckin) continue;

      const checkinUrl = `${BASE_URL}/checkin?c=${client.id}&w=${weekNo}`;
      const hinglish = isHinglish(client.phone);

      const params = hinglish
        ? [
            client.name || 'there',
            `Week ${weekNo}`,
            `Check-in form fill karo: ${checkinUrl}`,
          ]
        : [
            client.name || 'there',
            `Week ${weekNo}`,
            `Please fill your check-in form: ${checkinUrl}`,
          ];

      await sendWhatsApp(client.phone, 'weekly_checkin', params, true);
      sent++;

      const missedCount = await countConsecutiveMissed(client.id, weekNo);
      if (missedCount >= 2) {
        await escalateMissedCheckins(client.name, client.phone, missedCount);
        escalated++;
      }

      const prevWeek = weekNo - 1;
      if (prevWeek > 0) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', prevWeek)
          .maybeSingle();

        if (!prevCheckin) {
          const prevUrl = `${BASE_URL}/checkin?c=${client.id}&w=${prevWeek}`;
          await sendWhatsApp(client.phone, 'checkin_nudge', [
            client.name || 'there',
            `Week ${prevWeek}`,
            prevUrl,
          ], true);
          nudged++;
        }
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      active_clients: activeClients.length,
      sent,
      nudged,
      escalated,
    });
  } catch (err) {
    console.error(`Weekly checkin cron error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function calculateWeekNo(startedAt) {
  if (!startedAt) return 0;
  const start = new Date(startedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

async function countConsecutiveMissed(clientId, currentWeek) {
  let missed = 0;
  for (let w = currentWeek - 1; w >= 1; w--) {
    const { data } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', w)
      .maybeSingle();

    if (!data) {
      missed++;
    } else {
      break;
    }
  }
  return missed;
}
