const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    const escalations = [];

    for (const client of activeClients) {
      const weekNo = calculateWeekNo(client.program_started_at);
      if (weekNo < 1) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const missedCount = lastTwoWeeks.filter(w =>
        w > 0 && !missedCheckins?.some(c => c.week_no === w)
      ).length;

      if (missedCount >= 2) {
        escalations.push(client);
      }

      const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      if (isHinglish(market)) {
        await sendWhatsApp(client.phone, 'weekly_checkin_hi', [
          client.name || 'Champion',
          String(weekNo),
          formUrl,
        ]);
      } else {
        await sendWhatsApp(client.phone, 'weekly_checkin_en', [
          client.name || 'Champion',
          String(weekNo),
          formUrl,
        ]);
      }
      sent++;
    }

    for (const client of escalations) {
      await escalateToMaddy(
        client.phone,
        '2 consecutive missed check-ins',
        `Client ${client.name || 'Unknown'} on ${client.program}`
      );
    }

    return res.status(200).json({
      message: 'Weekly check-in sent',
      sent,
      escalations: escalations.length,
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.ceil(diffDays / 7);
}
