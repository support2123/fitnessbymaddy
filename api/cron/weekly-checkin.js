import supabase from '../../lib/supabase.js';
import { sendTemplate, sendText } from '../../lib/whatsapp.js';
import { isHinglishMarket, detectMarket, maskPhone } from '../../lib/market.js';
import { escalateToMaddy } from '../../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Failed to fetch clients:', error);
      return res.status(500).json({ error: 'Database error' });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of clients || []) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      // Check program end date
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      // Check for consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastWeekSubmitted = recentCheckins?.[0]?.week_no || 0;
      const missedWeeks = weekNo - lastWeekSubmitted - 1;

      if (missedWeeks >= 2) {
        await escalateToMaddy(
          client.phone,
          '2_consecutive_missed_checkins',
          `${client.name || 'Client'} missed ${missedWeeks} consecutive check-ins (last: week ${lastWeekSubmitted})`
        );
        escalated++;
      }

      const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglishMarket(market);

      const msg = hinglish
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time 📋\n\nApna progress update karo — weight, waist, photos, aur kaise feel kar rahe ho.\n\n👉 ${formUrl}\n\n5 min lagega, aur next week ka plan isi se banega!`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in 📋\n\nUpdate your progress — weight, waist, photos, and how you're feeling.\n\n👉 ${formUrl}\n\nTakes 5 min, and your next week's plan is built from this!`;

      await sendText(client.phone, msg, true);
      sent++;

      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
    }

    return res.status(200).json({ sent, nudged, escalated, total: clients?.length || 0 });
  } catch (err) {
    console.error('Weekly checkin cron error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
