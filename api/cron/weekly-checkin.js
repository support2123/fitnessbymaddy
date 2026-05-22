const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, isHinglish, detectMarket } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
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

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .limit(1);

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      if (!existingCheckin || existingCheckin.length === 0) {
        const { data: lastCheckin } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastWeekSubmitted = lastCheckin?.[0]?.week_no || 0;
        const missedWeeks = currentWeek - lastWeekSubmitted - 1;

        if (missedWeeks >= 2) {
          await createEscalation({
            sourceType: 'missed_checkins',
            sourceId: client.id,
            phone: client.phone,
            reason: `${missedWeeks} consecutive missed check-ins`,
            messageBody: `Client ${client.name} has missed ${missedWeeks} consecutive check-ins`
          });
          escalated++;
        }

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${currentWeek}`;

        const msg = hinglish
          ? `Hey ${client.name || 'Champion'}! 📋 Week ${currentWeek} ka check-in time aa gaya hai.\n\nApna progress yahan submit kar: ${checkinUrl}\n\nWeight, waist, photos, aur apna mood — sab share kar. Let's keep the momentum going! 🔥`
          : `Hey ${client.name || 'Champion'}! 📋 It's time for your Week ${currentWeek} check-in.\n\nSubmit your progress here: ${checkinUrl}\n\nShare your weight, waist, photos, and mood. Let's keep the momentum going! 🔥`;

        await sendWhatsApp({ phone: client.phone, body: msg });
        sent++;
      }
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      activeClients: activeClients.length,
      sent,
      nudged,
      escalated
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
