const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { json } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, { error: 'unauthorized' }, 401);
  }

  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (!activeClients || activeClients.length === 0) {
    return json(res, { action: 'no_active_clients' });
  }

  const results = [];

  for (const client of activeClients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.ceil(daysSinceStart / 7);

    if (currentWeek < 1) continue;

    // Check if program has ended
    if (client.program_ends_at && now > new Date(client.program_ends_at)) {
      await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
      results.push({ client_id: client.id, action: 'completed' });
      continue;
    }

    // Check if check-in already submitted this week
    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', currentWeek)
      .single();

    if (existing) {
      results.push({ client_id: client.id, action: 'already_submitted' });
      continue;
    }

    // Check for 2 consecutive missed check-ins → escalate
    if (currentWeek >= 3) {
      const { data: recentCheckins } = await db
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .gte('week_no', currentWeek - 2)
        .order('week_no', { ascending: false });

      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      const missed = [currentWeek - 1, currentWeek - 2].filter(w => !submittedWeeks.includes(w));

      if (missed.length >= 2) {
        await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
          name: 'Maddy',
          templateParams: [
            client.name || client.phone,
            `2 consecutive missed check-ins (weeks ${missed.join(', ')})`,
            new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          ],
        });
        results.push({ client_id: client.id, action: 'escalated_missed' });
      }
    }

    // Send check-in form
    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${currentWeek}`;

    await sendWhatsApp(client.phone, 'weekly_checkin', {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        String(currentWeek),
        checkinUrl,
      ],
    });

    results.push({ client_id: client.id, action: 'checkin_sent', week: currentWeek });
  }

  return json(res, { ok: true, processed: results.length, results });
};
