const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: activeClients } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active');

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
        .limit(1);

      if (existingCheckin && existingCheckin.length > 0) continue;

      const { data: missedCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      const lastTwoWeeks = [weekNo - 1, weekNo - 2];
      const consecutiveMissed = lastTwoWeeks.every(w => w > 0 && !submittedWeeks.includes(w));

      if (consecutiveMissed) {
        await escalateToMaddy({
          reason: '2 consecutive missed check-ins',
          phone: client.phone,
          name: client.name,
          context: `Program: ${client.program}, Week ${weekNo}`,
        });
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        bodyValues: [
          client.name || 'there',
          String(weekNo),
          checkinUrl,
        ],
      });

      sent++;
      console.log(`Check-in sent: ${maskPhone(client.phone)} week ${weekNo}`);
    }

    return res.json({
      ok: true,
      total_clients: activeClients.length,
      sent,
      escalated,
    });

  } catch (err) {
    console.error('Weekly checkin cron error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
