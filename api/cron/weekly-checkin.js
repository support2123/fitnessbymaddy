import supabase from '../../lib/supabase.js';
import { sendTemplate, sendText } from '../../lib/whatsapp.js';
import { detectMarket, isHinglishMarket } from '../../lib/market.js';
import { notifyMaddy } from '../../lib/whatsapp.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
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

      const endDate = new Date(client.program_ends_at);
      if (now > endDate) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existingCheckin) continue;

      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (recentCheckins && recentCheckins.length > 0) {
        const lastWeek = recentCheckins[0].week_no;
        if (currentWeek - lastWeek >= 3) {
          await notifyMaddy(
            '2+ consecutive missed check-ins',
            `Client: ${client.name} (${client.phone.slice(0, 3)}XXX...${client.phone.slice(-3)})\nLast check-in: Week ${lastWeek}\nCurrent week: ${currentWeek}`
          );
          escalated++;
        }
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = detectMarket(client.phone);
      const isIN = isHinglishMarket(market);

      const msg = isIN
        ? `Hi ${client.name || 'there'}! Week ${currentWeek} ka check-in time hai.\n\nApna progress update karo:\n${checkinUrl}\n\nWeight, waist, photos, aur feedback — sab bharo!`
        : `Hi ${client.name || 'there'}! Time for your Week ${currentWeek} check-in.\n\nUpdate your progress here:\n${checkinUrl}\n\nFill in your weight, waist, photos, and feedback!`;

      await sendText(client.phone, msg);
      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in reminders sent',
      total_clients: activeClients.length,
      sent,
      escalated
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
