import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { getCheckinUrl, jsonResponse } from '../../lib/helpers.js';
import { escalateToMaddy } from '../../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonResponse(res, { error: 'GET only' }, 405);

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}` || req.headers['x-vercel-cron'];
  if (!isCron && authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return jsonResponse(res, { ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const expectedCheckins = Math.min(currentWeek, 2);
      if (expectedCheckins - (missedCount || 0) >= 2) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          message: `Client has missed 2+ consecutive check-ins. Current week: ${currentWeek}`,
        });
        escalated++;
      }

      const checkinUrl = getCheckinUrl(client.id, currentWeek);
      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        `${currentWeek}`,
        checkinUrl,
      ]);
      sent++;
    }

    return jsonResponse(res, { ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return jsonResponse(res, { error: 'Cron failed' }, 500);
  }
}
