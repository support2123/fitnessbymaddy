const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/helpers');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads!inner(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weeksSinceStart = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
      const currentWeek = weeksSinceStart + 1;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const lastCheckedWeek = missedCheckins?.[0]?.week_no || 0;
      const missedConsecutive = currentWeek - lastCheckedWeek - 1;

      if (missedConsecutive >= 2) {
        await escalateToMaddy(
          client.phone,
          '2_consecutive_missed_checkins',
          `${client.name || 'Client'} has missed ${missedConsecutive} consecutive check-ins (last: week ${lastCheckedWeek}, current: week ${currentWeek})`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;
      const market = client.leads?.market || 'GLOBAL';
      const hinglish = isHinglish(market);

      if (hinglish) {
        await sendText(
          client.phone,
          `Hey ${client.name || 'there'}! Week ${currentWeek} check-in ka time ho gaya hai.\n\nApna progress yahan submit karo:\n${checkinUrl}\n\nWeight, waist, photos aur overall feel batao — taaki next week ka plan aur better bane.`
        );
      } else {
        await sendText(
          client.phone,
          `Hey ${client.name || 'there'}! It's time for your Week ${currentWeek} check-in.\n\nSubmit your progress here:\n${checkinUrl}\n\nUpdate your weight, waist, photos, and how you're feeling — so your next week's plan is even better.`
        );
      }

      sent++;
    }

    return res.status(200).json({ message: 'Weekly check-ins sent', sent, escalated });

  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron job failed' });
  }
};
