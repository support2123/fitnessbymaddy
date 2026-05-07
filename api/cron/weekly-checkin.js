import supabase from '../../lib/supabase.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { isHinglish, detectMarket } from '../../lib/market.js';
import { checkMissedCheckins } from '../../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch clients:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;

    for (const client of activeClients) {
      const weeksElapsed = Math.ceil(
        (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      );

      const programEnded = client.program_ends_at && new Date(client.program_ends_at) < new Date();
      if (programEnded) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        skipped++;
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weeksElapsed)
        .single();

      if (existingCheckin) {
        skipped++;
        continue;
      }

      await checkMissedCheckins(client.id);

      const market = detectMarket(client.phone);
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weeksElapsed}`;

      const templateName = isHinglish(market) ? 'weekly_checkin' : 'weekly_checkin_en';
      await sendTemplate(client.phone, templateName, [
        client.name || 'there',
        String(weeksElapsed),
        checkinUrl
      ]);

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in sent',
      total_clients: activeClients.length,
      sent,
      skipped
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
