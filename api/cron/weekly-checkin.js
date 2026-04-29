const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { checkMissedCheckins } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const db = getSupabase();

    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at, lead_id')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let nudged = 0;

    for (const client of clients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existing) continue;

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const { data: lead } = await db
        .from('leads')
        .select('market')
        .eq('id', client.lead_id)
        .single();

      const hinglish = lead && isHinglish(lead.market);

      const params = hinglish
        ? [client.name || 'there', `Week ${weekNo} check-in time! Form yahan fill karo: ${checkinUrl}`]
        : [client.name || 'there', `Time for your Week ${weekNo} check-in! Fill it here: ${checkinUrl}`];

      await sendWhatsApp(client.phone, 'weekly_checkin', params);
      sent++;

      await checkMissedCheckins(client.id, db);

      await scheduleNudges(db, client, weekNo, checkinUrl, hinglish);
    }

    return res.status(200).json({ message: 'Weekly check-ins sent', sent, total: clients.length });

  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function scheduleNudges(db, client, weekNo, checkinUrl, hinglish) {
  // Nudge records are stored so the daily nudge cron can pick them up
  // We store expected nudge times: +24hrs and +48hrs from now
  const now = new Date();

  const nudge24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nudge48 = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  // We use the messages table to track pending nudges by convention:
  // template_name = 'nudge_checkin_pending' with status = 'scheduled'
  await db.from('messages').insert([
    {
      phone: client.phone,
      direction: 'out',
      body: JSON.stringify({ client_id: client.id, week_no: weekNo, checkin_url: checkinUrl, hinglish }),
      template_name: 'nudge_checkin_pending',
      sent_at: nudge24.toISOString(),
      status: 'scheduled'
    },
    {
      phone: client.phone,
      direction: 'out',
      body: JSON.stringify({ client_id: client.id, week_no: weekNo, checkin_url: checkinUrl, hinglish }),
      template_name: 'nudge_checkin_pending',
      sent_at: nudge48.toISOString(),
      status: 'scheduled'
    }
  ]);
}
