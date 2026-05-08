const { supabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { detectMarket, isHinglish } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
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
      const daysSinceStart = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const completedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoExpected = [weekNo - 1, weekNo - 2].filter(w => w > 0);
      const consecutiveMissed = lastTwoExpected.filter(w => !completedWeeks.includes(w)).length;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          details: `${client.name || 'Client'} — missed weeks ${lastTwoExpected.join(', ')}`
        });
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const msgBody = hinglish
        ? [`Hey ${client.name || 'champ'}! 📊 Week ${weekNo} ka check-in time hai.\n\nYahan bharo: ${checkinUrl}\n\nWeight, waist, photos aur apna feedback dena. Ye progress track karne ke liye zaroori hai! 💪`]
        : [`Hey ${client.name || 'champ'}! 📊 It's Week ${weekNo} check-in time.\n\nFill it here: ${checkinUrl}\n\nShare your weight, waist, photos and feedback. This is key to tracking your progress! 💪`];

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msgBody,
        isClient: true
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      total_clients: activeClients.length,
      sent,
      escalated
    });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
