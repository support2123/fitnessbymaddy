import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { escalateMissedCheckins } from '../../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed) {
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
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
      if (endDate && now > endDate) continue;

      const { data: lastCheckin } = await supabase
        .from('checkins')
        .select('week_no, form_submitted_at')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .single();

      const lastCheckedWeek = lastCheckin?.week_no || 0;

      if (lastCheckedWeek >= currentWeek) continue;

      const missedWeeks = currentWeek - lastCheckedWeek - 1;

      if (missedWeeks >= 2) {
        await escalateMissedCheckins(client.name, client.phone, missedWeeks);
        escalated++;
        continue;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `Week ${currentWeek}`,
        checkinUrl,
      ]);
      sent++;
    }

    return res.status(200).json({
      success: true,
      active_clients: activeClients.length,
      checkins_sent: sent,
      escalations: escalated,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
