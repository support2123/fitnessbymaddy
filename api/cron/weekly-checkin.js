const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify Vercel cron authorization
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients' });
    }

    let sent = 0;
    let nudged = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNumber(client.program_started_at);

      // Check if already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      if (weekNo - lastCheckinWeek >= 3) {
        await escalateToMaddy('2+ missed check-ins', client.phone,
          `Client ${client.name || 'Unknown'} has missed ${weekNo - lastCheckinWeek - 1} consecutive check-ins`
        );
        escalated++;
        continue;
      }

      // Send check-in form
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (market === 'IN') {
        await sendText(client.phone,
          `Hey ${client.name || 'Champion'}! 🎯\n\n` +
          `Week ${weekNo} ka check-in time! Ye form fill karo (2 min):\n${checkinUrl}\n\n` +
          `Weight, waist, photos aur kaise feel ho raha hai — sab daal do. ` +
          `Isse mujhe tumhara next week ka plan customize karne mein help milegi 💪`
        );
      } else {
        await sendText(client.phone,
          `Hey ${client.name || 'Champion'}! 🎯\n\n` +
          `Time for your Week ${weekNo} check-in! Fill this form (2 min):\n${checkinUrl}\n\n` +
          `Include your weight, waist, photos and how you're feeling. ` +
          `This helps me customize your next week's plan 💪`
        );
      }
      sent++;
    }

    // Schedule nudges for clients who haven't submitted in 24hrs
    // (This is handled by the nudge-dropped cron checking checkin dates)

    return res.status(200).json({
      message: 'Weekly check-in sent',
      sent,
      nudged,
      escalated,
      total_clients: activeClients.length
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
}
