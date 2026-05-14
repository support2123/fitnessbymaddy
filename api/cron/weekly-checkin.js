import supabase from '../lib/supabase.js';
import { sendText } from '../lib/whatsapp.js';
import { isHinglishMarket } from '../lib/market.js';
import { BASE_URL, MADDY_PHONE } from '../lib/constants.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isService = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;
  if (!isCron && !isService) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);

      if (currentWeek < 1) {
        skipped++;
        continue;
      }

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const checkinUrl = `${BASE_URL}/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglishMarket(market);

      const msg = hinglish
        ? `Hey ${client.name || ''}! 📋 Week ${currentWeek} check-in time!\n\nApna weight, waist, aur progress photos submit karo:\n${checkinUrl}\n\nYeh Maddy ko tumhara program update karne mein help karega.`
        : `Hey ${client.name || ''}! 📋 Time for your Week ${currentWeek} check-in!\n\nSubmit your weight, waist, and progress photos:\n${checkinUrl}\n\nThis helps Maddy update your program.`;

      await sendText(client.phone, msg, true);
      sent++;

      const { count: missedCount } = await supabase
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2);

      const expectedCheckins = Math.min(currentWeek, 2);
      if (expectedCheckins > 0 && (missedCount || 0) === 0 && currentWeek >= 3) {
        await sendText(MADDY_PHONE,
          `⚠️ ${client.name || 'Client'} has missed 2 consecutive check-ins (Week ${currentWeek - 1} and ${currentWeek - 2}). Phone: ${client.phone}`,
          true
        );
      }
    }

    return res.status(200).json({ sent, skipped, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
}
