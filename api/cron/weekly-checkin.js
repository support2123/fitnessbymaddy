const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*, leads(market)')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const results = [];

    for (const client of activeClients) {
      try {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        await supabase.from('checkins').insert({
          client_id: client.id,
          week_no: weekNo,
        });

        const market = client.leads?.market || 'GLOBAL';
        const hinglish = isHinglish(market);

        const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const msg = hinglish
          ? `Hey ${client.name || 'there'}! Week ${weekNo} ka check-in time hai. Apni progress update kar 👇`
          : `Hey ${client.name || 'there'}! Time for your Week ${weekNo} check-in. Update your progress 👇`;

        await sendWhatsApp(client.phone, 'weekly_checkin', [
          client.name || 'there',
          msg,
          checkinUrl,
        ]);

        sent++;
        results.push({ client_id: client.id, week_no: weekNo });

        await checkMissedCheckins(client.id);

        scheduleNudges(client, weekNo, checkinUrl, market);
      } catch (e) {
        console.error(`Check-in error for ${client.id}:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, sent, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function scheduleNudges(client, weekNo, checkinUrl, market) {
  const hinglish = isHinglish(market);

  setTimeout(async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('checkins')
        .select('form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!data?.form_submitted_at) {
        const msg = hinglish
          ? `Reminder: Week ${weekNo} ka check-in abhi tak pending hai. 5 min lagega bas! 👇`
          : `Reminder: Your Week ${weekNo} check-in is still pending. Takes just 5 minutes! 👇`;
        await sendWhatsApp(client.phone, 'checkin_nudge', [client.name || 'there', msg, checkinUrl]);
      }
    } catch (e) {
      console.error('24hr nudge error:', e.message);
    }
  }, 24 * 60 * 60 * 1000);

  setTimeout(async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('checkins')
        .select('form_submitted_at')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (!data?.form_submitted_at) {
        const msg = hinglish
          ? `Last reminder! Week ${weekNo} check-in fill kar de — tera next week ka plan isi se bnega 💪`
          : `Last reminder! Fill your Week ${weekNo} check-in — your next program depends on it 💪`;
        await sendWhatsApp(client.phone, 'checkin_final_nudge', [client.name || 'there', msg, checkinUrl]);
      }
    } catch (e) {
      console.error('48hr nudge error:', e.message);
    }
  }, 48 * 60 * 60 * 1000);
}
