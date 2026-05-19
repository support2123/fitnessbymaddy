const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!activeClients || activeClients.length === 0) {
      return res.json({ ok: true, message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      const { data: existingCheckin } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) continue;

      const { data: lastTwo } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      if (lastTwo && lastTwo.length >= 1) {
        const lastWeek = lastTwo[0].week_no;
        if (weekNo - lastWeek >= 3) {
          await escalateToMaddy(
            '2+ consecutive missed check-ins',
            `Client: ${client.name || 'Unknown'} | Phone: ${client.phone.slice(0, 3)}XXX...${client.phone.slice(-3)} | Last check-in: Week ${lastWeek}, Current: Week ${weekNo}`
          );
          escalated++;
        }
      }

      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        params: [client.name || 'Champion', String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.json({ ok: true, sent, escalated, total: activeClients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
