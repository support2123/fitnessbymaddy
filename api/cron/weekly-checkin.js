import { getSupabase } from '../../lib/supabase.js';
import { sendWhatsApp } from '../../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../../lib/market.js';
import { escalateMissedCheckins } from '../../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, nudged: 0, escalated: 0, errors: 0 };

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients', results });
    }

    for (const client of activeClients) {
      try {
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const currentWeek = Math.ceil(daysSinceStart / 7);

        if (currentWeek < 1) continue;

        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastWeekSubmitted = lastCheckin?.week_no || 0;

        if (lastWeekSubmitted >= currentWeek) continue;

        const missedCount = currentWeek - lastWeekSubmitted - 1;
        if (missedCount >= 2) {
          await escalateMissedCheckins({
            clientName: client.name,
            phone: client.phone,
            weeksMissed: missedCount
          });
          results.escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;
        const market = detectMarket(client.phone);
        const body = isHinglish(market)
          ? `Hey ${client.name}! 📋 Week ${currentWeek} ka check-in time hai.\n\nForm yahan fill karo: ${checkinUrl}\n\nWeight, waist, compliance aur photos daal do — next week ka plan isi se banega!`
          : `Hey ${client.name}! 📋 Time for your Week ${currentWeek} check-in.\n\nFill out your form here: ${checkinUrl}\n\nInclude weight, waist, compliance, and photos — your next week's plan depends on it!`;

        await sendWhatsApp({
          phone: client.phone,
          templateName: 'weekly_checkin',
          body,
          isClient: true
        });

        results.sent++;
      } catch (err) {
        console.error(`Check-in send error for client ${client.id}:`, err.message);
        results.errors++;
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
