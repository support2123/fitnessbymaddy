const { supabase } = require('../_lib/supabase');
const { sendTemplate, notifyMaddy } = require('../_lib/whatsapp');
const { programWeeks, maskPhone } = require('../_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'POST') {
    // Vercel cron sends GET
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('[cron/weekly-checkin] DB error:', error.message);
      return res.status(500).json({ error: 'DB error' });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const currentWeek = Math.ceil(daysSinceStart / 7);
      const totalWeeks = programWeeks(client.program);

      if (currentWeek > totalWeeks) {
        await supabase
          .from('clients')
          .update({ status: 'completed' })
          .eq('id', client.id);
        continue;
      }

      if (currentWeek < 1) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', currentWeek)
        .single();

      if (existing) continue;

      const { data: missedCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(3);

      const submittedWeeks = (missedCheckins || []).map(c => c.week_no);
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1 && consecutiveMissed < 3; w--) {
        if (!submittedWeeks.includes(w)) {
          consecutiveMissed++;
        } else {
          break;
        }
      }

      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          '2+ consecutive missed check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nMissed: ${consecutiveMissed} weeks`
        );
        escalated++;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        currentWeek.toString(),
        checkinUrl,
      ]);

      sent++;
    }

    return res.status(200).json({
      ok: true,
      sent,
      escalated,
      total_active: clients.length,
    });
  } catch (err) {
    console.error('[cron/weekly-checkin] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
