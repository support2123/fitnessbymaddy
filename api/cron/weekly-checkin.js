const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = req.headers['authorization'];
  if (process.env.CRON_SECRET && cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) continue;

      const { data: lastCheckin } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastCheckin && lastCheckin.week_no >= weekNo) continue;

      const { count: missedCount } = await db
        .from('checkins')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id);

      const expectedCheckins = weekNo - 1;
      const actualCheckins = missedCount || 0;
      const consecutiveMissed = expectedCheckins - actualCheckins;

      if (consecutiveMissed >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          `Client: ${client.name || client.phone}\nProgram: ${client.program}\nWeek: ${weekNo}\nMissed: ${consecutiveMissed} check-ins`
        );
        escalated++;
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      const msg = market === 'IN'
        ? `Hey ${client.name || 'there'}! Week ${weekNo} check-in time 💪\n\nApna progress share karo: ${checkinUrl}\n\nWeight, measurements, aur photos daalein — isse hum aapka next week ka plan customise karenge!`
        : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in 💪\n\nShare your progress: ${checkinUrl}\n\nAdd your weight, measurements, and photos — this helps us customize your next week!`;

      await sendWhatsApp(
        client.phone,
        [client.name || 'there', String(weekNo), checkinUrl],
        'weekly_checkin'
      );
      sent++;

      await db.from('checkins').insert({
        client_id: client.id,
        week_no: weekNo
      });
    }

    return res.status(200).json({
      ok: true,
      sent,
      escalated,
      total: activeClients.length
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}
