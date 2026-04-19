import { getSupabase } from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { escalateToMaddy } from '../../lib/escalation.js';
import { maskPhone } from '../../lib/mask-phone.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
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

      const lastWeek = lastCheckin?.week_no || 0;

      if (lastWeek >= currentWeek) continue;

      const missedWeeks = currentWeek - lastWeek - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `${client.name || 'Client'} missed ${missedWeeks} check-ins (last: week ${lastWeek}, current: week ${currentWeek})`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'Champion',
        String(currentWeek),
        checkinUrl,
      ], true);

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${currentWeek}`);
    }

    return res.status(200).json({
      success: true,
      sent,
      escalated,
      total: activeClients.length,
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
