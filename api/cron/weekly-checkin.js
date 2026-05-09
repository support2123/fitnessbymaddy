const { getClient } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).end();
    }
  }

  const db = getClient();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / 86400000);
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1)
        .maybeSingle();

      if (existingCheckin) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const missedCount = weekNo - (missedCheckins ? missedCheckins.length : 0);
      if (missedCount >= 2 && weekNo > 2) {
        await escalateToMaddy('2+ consecutive missed check-ins', {
          phone: client.phone,
          name: client.name,
          clientId: client.id,
          message: `Client has missed ${missedCount} check-ins. Current week: ${weekNo}`
        });
        escalated++;
      }

      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);

      const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const msg = hinglish
        ? `Hey ${client.name || ''}! Week ${weekNo} check-in time \u{1F4AA} Apna progress update karo:\n${formUrl}\nPhotos + stats daal do — isse next week ka plan aur better banega!`
        : `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in \u{1F4AA}\n${formUrl}\nSubmit your stats + photos so we can optimise your next week!`;

      await sendWhatsApp(client.phone, msg, 'weekly_checkin', true);
      sent++;

      console.log(`Check-in sent to ${maskPhone(client.phone)} week ${weekNo}`);
    }

    return res.status(200).json({ sent, escalated, total: activeClients.length });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
